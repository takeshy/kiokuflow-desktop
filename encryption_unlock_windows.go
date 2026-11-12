//go:build windows

package main

import (
	"runtime"
	"unsafe"

	"golang.org/x/sys/windows"
)

const encryptionUnlockSupported = true

func encryptionUnlockDPAPI(data []byte, protect bool) ([]byte, error) {
	input := windows.DataBlob{Size: uint32(len(data)), Data: unsafe.SliceData(data)}
	entropyBytes := []byte("gemihub-desktop:encryption-unlock:v1")
	entropy := windows.DataBlob{Size: uint32(len(entropyBytes)), Data: unsafe.SliceData(entropyBytes)}
	var output windows.DataBlob
	var err error
	if protect {
		// Use the current Windows user scope, never LOCAL_MACHINE.
		err = windows.CryptProtectData(&input, nil, &entropy, 0, nil, windows.CRYPTPROTECT_UI_FORBIDDEN, &output)
	} else {
		err = windows.CryptUnprotectData(&input, nil, &entropy, 0, nil, windows.CRYPTPROTECT_UI_FORBIDDEN, &output)
	}
	runtime.KeepAlive(data)
	runtime.KeepAlive(entropyBytes)
	if err != nil {
		return nil, err
	}
	defer windows.LocalFree(windows.Handle(unsafe.Pointer(output.Data)))
	buffer := unsafe.Slice(output.Data, int(output.Size))
	result := append([]byte(nil), buffer...)
	clear(buffer)
	return result, nil
}

func protectEncryptionUnlock(data []byte) ([]byte, error) {
	return encryptionUnlockDPAPI(data, true)
}

func unprotectEncryptionUnlock(data []byte) ([]byte, error) {
	return encryptionUnlockDPAPI(data, false)
}
