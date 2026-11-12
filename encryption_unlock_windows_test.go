//go:build windows

package main

import (
	"bytes"
	"testing"
)

func TestEncryptionUnlockDPAPIRoundTrip(t *testing.T) {
	plain := []byte("test-encryption-unlock-password")
	protected, err := protectEncryptionUnlock(plain)
	if err != nil {
		t.Fatal(err)
	}
	if bytes.Contains(protected, plain) {
		t.Fatal("DPAPI did not protect the password")
	}
	restored, err := unprotectEncryptionUnlock(protected)
	if err != nil || !bytes.Equal(plain, restored) {
		t.Fatal("DPAPI could not restore the password")
	}
	protected[len(protected)-1] ^= 1
	if _, err := unprotectEncryptionUnlock(protected); err == nil {
		t.Fatal("DPAPI accepted tampered ciphertext")
	}
}
