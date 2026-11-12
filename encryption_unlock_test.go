package main

import (
	"bytes"
	"crypto/aes"
	"crypto/cipher"
	"crypto/rand"
	"errors"
	"os"
	"path/filepath"
	"testing"
	"time"
)

func testEncryptionUnlockStore(t *testing.T) (*encryptionUnlockStore, *time.Time) {
	t.Helper()
	key := make([]byte, 32)
	if _, err := rand.Read(key); err != nil {
		t.Fatal(err)
	}
	block, err := aes.NewCipher(key)
	if err != nil {
		t.Fatal(err)
	}
	aead, err := cipher.NewGCM(block)
	if err != nil {
		t.Fatal(err)
	}
	now := time.Date(2026, 11, 13, 10, 0, 0, 0, time.UTC)
	return &encryptionUnlockStore{
		path: filepath.Join(t.TempDir(), "credentials", "encryption-unlock.dat"),
		now:  func() time.Time { return now },
		protect: func(data []byte) ([]byte, error) {
			nonce := make([]byte, aead.NonceSize())
			if _, err := rand.Read(nonce); err != nil {
				return nil, err
			}
			return aead.Seal(nonce, nonce, data, nil), nil
		},
		unprotect: func(data []byte) ([]byte, error) {
			if len(data) < aead.NonceSize() {
				return nil, errors.New("invalid ciphertext")
			}
			return aead.Open(nil, data[:aead.NonceSize()], data[aead.NonceSize():], nil)
		},
	}, &now
}

func TestEncryptionUnlockPersistsWithFixedExpiry(t *testing.T) {
	s, now := testEncryptionUnlockStore(t)
	if err := s.remember("test-password", "public-key", 7); err != nil {
		t.Fatal(err)
	}
	stored, err := os.ReadFile(s.path)
	if err != nil {
		t.Fatal(err)
	}
	if bytes.Contains(stored, []byte("test-password")) || bytes.Contains(stored, []byte("public-key")) {
		t.Fatal("unlock information was written in plaintext")
	}
	expires := now.Add(7 * 24 * time.Hour)
	*now = now.Add(6 * 24 * time.Hour)
	reopened := *s
	unlock, err := reopened.restore("public-key")
	if err != nil || unlock == nil || unlock.Password != "test-password" || unlock.ExpiresAt != expires.UnixMilli() {
		t.Fatal("valid unlock was not restored with its original expiry")
	}
	after, _ := os.ReadFile(s.path)
	if !bytes.Equal(stored, after) {
		t.Fatal("restoring must not renew or rewrite the saved unlock")
	}
	*now = expires
	unlock, err = reopened.restore("public-key")
	if err != nil || unlock != nil {
		t.Fatal("expired unlock was restored")
	}
	if _, err := os.Stat(s.path); !os.IsNotExist(err) {
		t.Fatal("expired unlock was not deleted")
	}
}

func TestEncryptionUnlockInvalidatedOrForgotten(t *testing.T) {
	for _, scenario := range []string{"changed-profile", "corrupt", "unavailable-account", "forget"} {
		t.Run(scenario, func(t *testing.T) {
			s, _ := testEncryptionUnlockStore(t)
			if err := s.remember("test-password", "public-key", 1); err != nil {
				t.Fatal(err)
			}
			profile := "public-key"
			switch scenario {
			case "changed-profile":
				profile = "new-public-key"
			case "corrupt":
				if err := os.WriteFile(s.path, []byte("corrupt"), 0o600); err != nil {
					t.Fatal(err)
				}
			case "unavailable-account":
				s.unprotect = func([]byte) ([]byte, error) { return nil, errors.New("different Windows account") }
			case "forget":
				if err := s.forget(); err != nil {
					t.Fatal(err)
				}
			}
			unlock, err := s.restore(profile)
			if err != nil || unlock != nil {
				t.Fatal("unavailable unlock should return to password entry")
			}
			if _, err := os.Stat(s.path); !os.IsNotExist(err) {
				t.Fatal("invalid unlock was not removed")
			}
		})
	}
}

func TestEncryptionUnlockRejectsInvalidRetention(t *testing.T) {
	s, _ := testEncryptionUnlockStore(t)
	for _, days := range []int{-1, 0, 2, 31, 999} {
		if err := s.remember("test-password", "public-key", days); err == nil {
			t.Fatalf("accepted unsupported retention %d", days)
		}
	}
	if err := s.remember("", "public-key", 7); err == nil {
		t.Fatal("accepted an empty password")
	}
}
