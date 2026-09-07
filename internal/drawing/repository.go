package drawing

import (
	"errors"
	"fmt"
	"io/fs"
	"log/slog"
	"os"
	"path/filepath"
	"sort"
	"strings"
	"sync"

	"github.com/SherlockGy/excaligo/internal/storage"
)

// Repository holds directory capabilities for the current application session.
// Root-relative operations prevent symlink traversal, including concurrent swaps.
type Repository struct {
	mu     sync.Mutex
	roots  map[string]*os.Root
	logger *slog.Logger
}

func NewRepository(logger *slog.Logger) *Repository {
	if logger == nil {
		logger = slog.Default()
	}
	return &Repository{roots: make(map[string]*os.Root), logger: logger}
}

func (r *Repository) Close() error {
	r.mu.Lock()
	defer r.mu.Unlock()
	var result error
	for name, root := range r.roots {
		result = errors.Join(result, root.Close())
		delete(r.roots, name)
	}
	return result
}

// AllowDirectory is called after directory selection or restoration of a saved
// workspace. It does not modify the selected directory.
func (r *Repository) AllowDirectory(directory string) (string, error) {
	logPrefix := fmt.Sprintf("[AllowDirectory 打开工作目录][directory=%s]", directory)
	canonical, err := filepath.EvalSymlinks(directory)
	if err != nil {
		return "", err
	}
	canonical, err = filepath.Abs(canonical)
	if err != nil {
		return "", err
	}
	r.mu.Lock()
	defer r.mu.Unlock()
	if _, ok := r.roots[canonical]; ok {
		return canonical, nil
	}
	// A parent capability already covers this directory. Keeping overlapping
	// handles would make a formerly opened child impossible to rename/delete.
	if _, _, err := r.locate(canonical); err == nil {
		return canonical, nil
	}
	root, err := os.OpenRoot(canonical)
	if err != nil {
		return "", err
	}
	r.roots[canonical] = root
	for base, child := range r.roots {
		rel, err := filepath.Rel(canonical, base)
		if err == nil && rel != "." && filepath.IsLocal(rel) {
			_ = child.Close()
			delete(r.roots, base)
		}
	}
	r.logger.Info(logPrefix)
	return canonical, nil
}

func (r *Repository) locate(path string) (*os.Root, string, error) {
	abs, err := filepath.Abs(path)
	if err != nil {
		return nil, "", err
	}
	var selected string
	for base := range r.roots {
		rel, err := filepath.Rel(base, abs)
		if err == nil && (rel == "." || filepath.IsLocal(rel)) && len(base) > len(selected) {
			selected = base
		}
	}
	if selected == "" {
		return nil, "", errors.New("path is outside the opened directories")
	}
	rel, err := filepath.Rel(selected, abs)
	return r.roots[selected], rel, err
}

func (r *Repository) Tree(directory string) ([]Node, error) {
	r.mu.Lock()
	defer r.mu.Unlock()
	root, rel, err := r.locate(directory)
	if err != nil {
		return nil, err
	}
	return buildTree(root, rel)
}

func buildTree(root *os.Root, directory string) ([]Node, error) {
	f, err := root.Open(directory)
	if err != nil {
		return nil, err
	}
	entries, readErr := f.ReadDir(-1)
	closeErr := f.Close()
	if err := errors.Join(readErr, closeErr); err != nil {
		return nil, err
	}
	nodes := make([]Node, 0)
	for _, entry := range entries {
		if strings.HasPrefix(entry.Name(), ".") || entry.Type()&fs.ModeSymlink != 0 {
			continue
		}
		rel := filepath.Join(directory, entry.Name())
		node := Node{Name: entry.Name(), Path: filepath.Join(root.Name(), rel), IsDirectory: entry.IsDir()}
		if entry.IsDir() {
			node.Children, err = buildTree(root, rel)
			if err != nil {
				return nil, err
			}
		} else if !entry.Type().IsRegular() || filepath.Ext(entry.Name()) != Extension {
			continue
		}
		nodes = append(nodes, node)
	}
	sort.Slice(nodes, func(i, j int) bool {
		if nodes[i].IsDirectory != nodes[j].IsDirectory {
			return nodes[i].IsDirectory
		}
		return nodes[i].Name < nodes[j].Name
	})
	return nodes, nil
}

func (r *Repository) List(directory string) ([]File, error) {
	tree, err := r.Tree(directory)
	if err != nil {
		return nil, err
	}
	files := make([]File, 0)
	var collect func([]Node)
	collect = func(nodes []Node) {
		for _, n := range nodes {
			if n.IsDirectory {
				collect(n.Children)
			} else {
				files = append(files, File{Name: n.Name, Path: n.Path})
			}
		}
	}
	collect(tree)
	sort.SliceStable(files, func(i, j int) bool { return files[i].Name < files[j].Name })
	return files, nil
}

func (r *Repository) read(path string, validate bool) (Content, error) {
	r.mu.Lock()
	defer r.mu.Unlock()
	if err := validateExtension(path); err != nil {
		return Content{}, err
	}
	root, rel, err := r.locate(path)
	if err != nil {
		return Content{}, err
	}
	info, err := root.Stat(rel)
	if err != nil {
		return Content{}, err
	}
	if !info.Mode().IsRegular() {
		return Content{}, errors.New("path is not a regular file")
	}
	data, err := root.ReadFile(rel)
	if err != nil {
		return Content{}, err
	}
	content := string(data)
	if validate {
		if err := Validate(content); err != nil {
			return Content{}, err
		}
	}
	return Content{Content: content, ContentHash: Hash(content)}, nil
}

func (r *Repository) Read(path string) (Content, error) { return r.read(path, true) }
func (r *Repository) HashFile(path string) (string, error) {
	result, err := r.read(path, false)
	return result.ContentHash, err
}

func (r *Repository) Save(path, content string) (string, error)   { return r.save(path, content, false) }
func (r *Repository) SaveAs(path, content string) (string, error) { return r.save(path, content, true) }

func (r *Repository) save(path, content string, create bool) (string, error) {
	logPrefix := fmt.Sprintf("[Save 保存绘图][filePath=%s]", path)
	if err := validateExtension(path); err != nil {
		return "", err
	}
	if err := Validate(content); err != nil {
		return "", err
	}
	r.mu.Lock()
	defer r.mu.Unlock()
	root, rel, err := r.locate(path)
	if err != nil {
		return "", err
	}
	mode := fs.FileMode(0600)
	info, err := root.Lstat(rel)
	if err != nil && !(create && errors.Is(err, fs.ErrNotExist)) {
		return "", err
	}
	if info != nil {
		if !info.Mode().IsRegular() {
			return "", errors.New("refusing to overwrite a non-regular file")
		}
		mode = info.Mode().Perm()
	}
	if err := storage.WriteAtomic(root, rel, []byte(content), mode); err != nil {
		r.logger.Error(logPrefix, "error", err)
		return "", err
	}
	r.logger.Debug(logPrefix, "bytes", len(content))
	return Hash(content), nil
}

func (r *Repository) CreateFile(directory, name string) (string, error) {
	return r.create(directory, name, false)
}
func (r *Repository) CreateFolder(directory, name string) (string, error) {
	return r.create(directory, name, true)
}

func (r *Repository) create(directory, name string, folder bool) (string, error) {
	logPrefix := fmt.Sprintf("[Create 创建文件或目录][directory=%s][name=%s]", directory, name)
	clean, err := SafeName(name)
	if err != nil {
		return "", err
	}
	if !folder && !strings.HasSuffix(clean, Extension) {
		clean += Extension
	}
	r.mu.Lock()
	defer r.mu.Unlock()
	root, dir, err := r.locate(directory)
	if err != nil {
		return "", err
	}
	stem, ext := clean, ""
	if !folder {
		stem, ext = strings.TrimSuffix(clean, Extension), Extension
	}
	for attempt := 0; attempt <= 100; attempt++ {
		candidate := clean
		if attempt > 0 {
			candidate = fmt.Sprintf("%s-%d%s", stem, attempt, ext)
		}
		rel := filepath.Join(dir, candidate)
		if folder {
			err = root.Mkdir(rel, 0755)
		} else {
			var f *os.File
			f, err = root.OpenFile(rel, os.O_CREATE|os.O_EXCL|os.O_WRONLY, 0600)
			if err == nil {
				_, writeErr := f.WriteString(DefaultContent)
				syncErr := f.Sync()
				closeErr := f.Close()
				err = errors.Join(writeErr, syncErr, closeErr)
				if err != nil {
					_ = root.Remove(rel)
					return "", err
				}
			}
		}
		if errors.Is(err, fs.ErrExist) {
			continue
		}
		if err != nil {
			return "", err
		}
		path := filepath.Join(root.Name(), rel)
		r.logger.Info(logPrefix, "path", path)
		return path, nil
	}
	return "", errors.New("could not find a unique name after 100 attempts")
}

func (r *Repository) RenameFile(path, name string) (string, error) {
	return r.rename(path, name, false)
}
func (r *Repository) RenameFolder(path, name string) (string, error) {
	return r.rename(path, name, true)
}

func (r *Repository) rename(path, name string, folder bool) (string, error) {
	logPrefix := fmt.Sprintf("[Rename 重命名文件或目录][path=%s]", path)
	clean, err := SafeName(name)
	if err != nil {
		return "", err
	}
	if !folder && filepath.Ext(clean) != Extension {
		clean = strings.TrimSuffix(clean, filepath.Ext(clean)) + Extension
	}
	r.mu.Lock()
	defer r.mu.Unlock()
	root, rel, err := r.locate(path)
	if err != nil {
		return "", err
	}
	if err := checkTarget(root, rel, folder); err != nil {
		return "", err
	}
	newRel := filepath.Join(filepath.Dir(rel), clean)
	if rel == newRel {
		return filepath.Join(root.Name(), rel), nil
	}
	if _, err := root.Lstat(newRel); err == nil {
		return "", errors.New("a file or folder with that name already exists")
	} else if !errors.Is(err, fs.ErrNotExist) {
		return "", err
	}
	if err := storage.MoveNoReplace(root, rel, newRel); err != nil {
		return "", err
	}
	r.logger.Info(logPrefix, "newName", clean)
	return filepath.Join(root.Name(), newRel), nil
}

func checkTarget(root *os.Root, rel string, folder bool) error {
	if rel == "." {
		return errors.New("cannot modify an opened root directory")
	}
	info, err := root.Lstat(rel)
	if err != nil {
		return err
	}
	if info.Mode()&fs.ModeSymlink != 0 {
		return errors.New("cannot rename or delete symbolic links")
	}
	if folder {
		if !info.IsDir() {
			return errors.New("path is not a folder")
		}
	} else {
		if !info.Mode().IsRegular() {
			return errors.New("path is not a regular file")
		}
		return validateExtension(rel)
	}
	return nil
}

func (r *Repository) DeleteFile(path string) error   { return r.remove(path, false) }
func (r *Repository) DeleteFolder(path string) error { return r.remove(path, true) }

func (r *Repository) remove(path string, folder bool) error {
	logPrefix := fmt.Sprintf("[Delete 删除文件或目录][path=%s]", path)
	r.mu.Lock()
	defer r.mu.Unlock()
	root, rel, err := r.locate(path)
	if err != nil {
		return err
	}
	if err := checkTarget(root, rel, folder); err != nil {
		return err
	}
	if folder {
		err = root.RemoveAll(rel)
	} else {
		err = root.Remove(rel)
	}
	if err != nil {
		r.logger.Error(logPrefix, "error", err)
		return err
	}
	r.logger.Info(logPrefix)
	return nil
}
