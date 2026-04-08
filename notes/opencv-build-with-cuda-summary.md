# OpenCV CUDA Build Summary

## Source

- Original gist: https://gist.github.com/minhhieutruong0705/8f0ec70c400420e0007c15c98510f133
- Source file: `OpenCV_Build-Guide.md`
- Source title: `Guide to build OpenCV from source with GPU support (CUDA and cuDNN)`
- Source environment: Ubuntu 20.04 x86_64, Python 3.8, NVIDIA GeForce RTX 3090
- Source result: OpenCV 4.5.5 with CUDA 11.6 and cuDNN 8.3.2
- Source created: February 21, 2022
- Gist last active: February 6, 2026

## Summary

This guide is a version-pinned build note, not a universal recipe. Its core idea is:

1. Remove conflicting OpenCV Python or distro packages first.
2. Build `opencv` and `opencv_contrib` from the same tag.
3. Enable CUDA, cuDNN, DNN CUDA, GStreamer, TBB, and Python bindings in CMake.
4. Verify the CMake summary before compiling, especially `NVIDIA CUDA: YES` and `cuDNN: YES`.
5. Install into `/usr/local`, then make sure Python can find the generated `cv2`.

## When This Note Is Useful

- You need OpenCV CUDA support that is usually missing from distro packages or `pip` wheels.
- You want OpenCV DNN to run on NVIDIA GPU.
- You are building on Ubuntu and can adjust version-specific paths yourself.

## Main Flow

### 1. Prepare dependencies

The source groups dependencies into these buckets:

- Generic build tools: `build-essential`, `cmake`, `pkg-config`, `git`, `checkinstall`
- Python: `python3-dev`, `python3-numpy`, `python3-pip`, `python3-testresources`
- Image codecs: `libjpeg-dev`, `libpng-dev`, `libtiff-dev`
- Video stack: FFmpeg, GStreamer, x264/xvid, Theora, Vorbis
- Camera / V4L: `libdc1394-*`, `libv4l-dev`, `v4l-utils`
- GUI: `libgtk-3-dev`
- Parallelism / math: `libtbb-dev`, `libatlas-base-dev`, `gfortran`
- Optional extras: protobuf, glog, gflags, gphoto2, Eigen, HDF5, doxygen

Before building, the source explicitly removes conflicting OpenCV packages:

- `python3 -m pip uninstall opencv-python-headless`
- `sudo apt-get remove python3-opencv`

The source also notes one fallback: if you intentionally keep `python3-opencv`, you may need to add `-D HAVE_opencv_python3=ON` during configuration. Treat that as a workaround, not the default path.

### 2. Sync OpenCV core and contrib versions

Clone both repositories and checkout the same version tag:

```bash
git clone https://github.com/opencv/opencv.git
git clone https://github.com/opencv/opencv_contrib.git
cd ~/opencv && git checkout <opencv-version>
cd ~/opencv_contrib && git checkout <opencv-version>
```

The note uses OpenCV `4.5.5`.

If you do not want a git checkout, the source also gives an archive-based path: download matching `opencv` and `opencv_contrib` zip packages, unzip them, and rename the extracted folders so the later CMake paths stay simple.

### 3. Configure CMake correctly

Create a separate build directory:

```bash
mkdir ~/opencv_build
cd ~/opencv_build
```

The essential configuration points are:

- `OPENCV_EXTRA_MODULES_PATH=~/opencv_contrib/modules/`
- Python executable / include / library / NumPy include paths must match the local Python version
- `OPENCV_GENERATE_PKGCONFIG=ON`
- `OPENCV_PC_FILE_NAME=opencv.pc`
- `WITH_CUDA=ON`
- `WITH_CUDNN=ON`
- `OPENCV_DNN_CUDA=ON`
- `CUDA_ARCH_BIN=<your GPU compute capability>`
- `ENABLE_FAST_MATH=ON`
- `CUDA_FAST_MATH=ON`
- `WITH_CUFFT=ON`
- `WITH_CUBLAS=ON`
- `WITH_V4L=ON`
- `WITH_GSTREAMER=ON`
- `WITH_TBB=ON`
- `WITH_OPENCL=ON`
- `WITH_OPENGL=ON` only as best effort

The source example for RTX 3090 uses:

- `CUDA_ARCH_BIN=8.6`

### 4. Stop and inspect the CMake summary

Do not compile immediately. First verify that the generated summary shows:

- `NVIDIA CUDA: YES`
- `cuDNN: YES`
- expected GPU architecture
- Python 3 binding paths
- expected extra modules path

If these lines are missing, the build will likely succeed but not produce the GPU-enabled result you wanted.

The source's intended CUDA summary is more specific than a plain `YES`. It expects CUDA-related acceleration features to appear in the line, for example `CUFFT`, `CUBLAS`, and `FAST_MATH`.

### 5. Build and install

Compile with all CPU cores:

```bash
make -j"$(nproc)"
sudo make install
sudo /bin/bash -c 'echo "/usr/local/lib" >> /etc/ld.so.conf.d/opencv.conf'
sudo ldconfig
```

Before `sudo make install`, the source does a quick sanity check inside the build tree:

- `ls bin`
- `ls lib`
- `ls OpenCVConfig*.cmake`
- `ls OpenCVModules.cmake`

That check does not prove the build is correct, but it is a cheap way to catch obviously incomplete build output before installation.

## Verification Checklist

After installation, verify both Python import and build flags:

```python
import cv2
print(cv2.__version__)
print(cv2.getBuildInformation())
```

Focus on whether build information still reports CUDA and cuDNN support.

The source also checks whether the installed Python package directory exists directly, for example:

```bash
ls /usr/local/lib/python3.8/site-packages/cv2
```

This is useful when CMake succeeded but Python still imports a different `cv2` from another location.

If `cv2` cannot be imported, inspect Python search paths:

```bash
python3 -m site
```

If needed, add `/usr/local/lib/python3.8/site-packages` to `PYTHONPATH` or adapt the path to the Python version actually used on the machine.

For persistence, the source suggests exporting `PYTHONPATH` from either `~/.bashrc` or `/etc/profile`, depending on whether the change should be user-local or system-wide.

## Important Caveats

### 1. This note is dated

The source was written on February 22, 2022 for:

- Ubuntu 20.04
- Python 3.8
- OpenCV 4.5.5
- CUDA 11.6
- cuDNN 8.3.2
- RTX 3090

On newer systems, at least these values usually need adjustment:

- Python include/library paths
- CUDA toolkit version
- cuDNN version
- `CUDA_ARCH_BIN`
- package names that changed across Ubuntu releases

### 2. OpenGL is the main trap in this guide

The source explicitly warns:

- enabling `WITH_OPENGL=ON` does not guarantee usable OpenCV OpenGL support
- `libgtkglext1` and `libgtkglext1-dev` may help CMake detect OpenGL, but can also trigger compile failures on OpenCV 4.x

The sample summary in the source still ends with `OpenGL support: NO`, so this flag should be treated as best effort, not guaranteed output.

### 3. The Python path in the source is version-pinned

The sample CMake command hard-codes Python 3.8 paths such as:

- `/usr/include/python3.8/`
- `/usr/lib/x86_64-linux-gnu/libpython3.8.so`
- `/usr/local/lib/python3.8/site-packages`

Those values are part of the author's machine state, not reusable constants. On any newer Ubuntu or different interpreter install, update all of them as one set.

### 4. Python package conflicts are easy to overlook

If `python3-opencv` or a previous `pip` OpenCV package is still installed, imports may succeed while actually loading the wrong build. The source removes both before compilation to avoid that ambiguity.

## Minimal Reusable Template

For later reuse, the most important commands are:

```bash
python3 -m pip uninstall opencv-python-headless
sudo apt-get remove python3-opencv

git clone https://github.com/opencv/opencv.git
git clone https://github.com/opencv/opencv_contrib.git

mkdir ~/opencv_build
cd ~/opencv_build

cmake -D CMAKE_BUILD_TYPE=Release \
  -D CMAKE_INSTALL_PREFIX=/usr/local \
  -D OPENCV_EXTRA_MODULES_PATH=~/opencv_contrib/modules/ \
  -D WITH_CUDA=ON \
  -D WITH_CUDNN=ON \
  -D OPENCV_DNN_CUDA=ON \
  -D CUDA_ARCH_BIN=<compute-capability> \
  -D WITH_GSTREAMER=ON \
  -D WITH_TBB=ON \
  -D WITH_OPENCL=ON \
  ../opencv

make -j"$(nproc)"
sudo make install
sudo ldconfig
```

In real use, fill in the Python-related CMake paths explicitly instead of assuming the source example still matches the target machine.

## Uninstall Path

The source also includes a clean uninstall route:

```bash
cd ~/opencv_build
sudo make uninstall
cd ..
sudo rm -r opencv_build
sudo find /usr/local -name "*opencv*" -exec rm -i {} \;
sudo find /usr/local -name "*cv2*" -exec rm -i {} \;
```

Use the `find ... -exec rm -i` steps carefully because they may match files from unrelated local builds.
