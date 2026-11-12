# Agent Instructions

## Windows ARM64 build

When asked to build the Windows ARM64 executable, run the following Wails v3
commands from the project root in the WSL host environment, outside the sandbox:

```bash
CGO_ENABLED=0 go install -tags server github.com/wailsapp/wails/v3/cmd/wails3@v3.1.0
wails3 task windows:build ARCH=arm64
```

The CLI uses the server build tag so installing it on WSL does not require
GTK/WebKit development libraries. This does not change the Windows build target.

Do not invoke Windows PowerShell for the executable build. The output is written
to `bin/kiokuflow-desktop.exe`. The Store-ready MSIX is built on a Windows host or
CI with `wails3 task windows:msix ARCH=arm64`.
