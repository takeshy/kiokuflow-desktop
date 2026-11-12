//go:build !windows

package main

import "errors"

const encryptionUnlockSupported = false

func protectEncryptionUnlock([]byte) ([]byte, error) {
	return nil, errors.New("OS-protected encryption unlock storage is not available")
}

func unprotectEncryptionUnlock([]byte) ([]byte, error) {
	return nil, errors.New("OS-protected encryption unlock storage is not available")
}
