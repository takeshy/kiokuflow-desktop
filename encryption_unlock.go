package main

import (
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"errors"
	"os"
	"path/filepath"
	"strings"
	"sync"
	"time"
)

type RememberedEncryptionUnlock struct {
	Password  string `json:"password"`
	ExpiresAt int64  `json:"expiresAt"`
}

type encryptionUnlockRecord struct {
	RememberedEncryptionUnlock
	Profile string `json:"profile"`
}

type encryptionUnlockStore struct {
	path      string
	now       func() time.Time
	protect   func([]byte) ([]byte, error)
	unprotect func([]byte) ([]byte, error)
}

var encryptionUnlockMu sync.Mutex

func nativeEncryptionUnlockStore() (*encryptionUnlockStore, error) {
	config, err := os.UserConfigDir()
	if err != nil {
		return nil, err
	}
	return &encryptionUnlockStore{
		path: filepath.Join(config, appDataID, "credentials", "encryption-unlock.dat"),
		now:  time.Now, protect: protectEncryptionUnlock, unprotect: unprotectEncryptionUnlock,
	}, nil
}

func encryptionProfileFingerprint(profile string) string {
	sum := sha256.Sum256([]byte(profile))
	return hex.EncodeToString(sum[:])
}

func (s *encryptionUnlockStore) remember(password, profile string, days int) error {
	if password == "" || strings.TrimSpace(profile) == "" || len(password) > 16384 || len(profile) > 16384 {
		return errors.New("Invalid encryption unlock information")
	}
	if days != 1 && days != 7 && days != 30 {
		return errors.New("Invalid encryption unlock retention period")
	}
	record := encryptionUnlockRecord{
		RememberedEncryptionUnlock: RememberedEncryptionUnlock{
			Password: password, ExpiresAt: s.now().Add(time.Duration(days) * 24 * time.Hour).UnixMilli(),
		},
		Profile: encryptionProfileFingerprint(profile),
	}
	plain, err := json.Marshal(record)
	if err != nil {
		return err
	}
	defer clear(plain)
	protected, err := s.protect(plain)
	if err != nil {
		return errors.New("Could not protect the remembered encryption unlock")
	}
	if err := os.MkdirAll(filepath.Dir(s.path), 0o700); err != nil {
		return err
	}
	return writeAtomic(s.path, protected)
}

func (s *encryptionUnlockStore) forget() error {
	if err := os.Remove(s.path); err != nil && !os.IsNotExist(err) {
		return err
	}
	return nil
}

func (s *encryptionUnlockStore) restore(profile string) (*RememberedEncryptionUnlock, error) {
	protected, err := os.ReadFile(s.path)
	if os.IsNotExist(err) {
		return nil, nil
	}
	if err != nil {
		return nil, err
	}
	plain, unprotectErr := s.unprotect(protected)
	defer clear(plain)
	var record encryptionUnlockRecord
	if unprotectErr != nil || json.Unmarshal(plain, &record) != nil || record.Password == "" ||
		record.Profile != encryptionProfileFingerprint(profile) || record.ExpiresAt <= s.now().UnixMilli() {
		// Expired, replaced, or unreadable records must return to the password
		// prompt. Never extend the expiry just because the app was restarted.
		return nil, s.forget()
	}
	return &record.RememberedEncryptionUnlock, nil
}

func (a *App) EncryptionUnlockSupported() bool { return encryptionUnlockSupported }

func (a *App) RememberEncryptionUnlock(password, profile string, days int) error {
	if !encryptionUnlockSupported {
		return errors.New("Remembering encryption unlocks is not supported on this platform")
	}
	encryptionUnlockMu.Lock()
	defer encryptionUnlockMu.Unlock()
	store, err := nativeEncryptionUnlockStore()
	if err != nil {
		return err
	}
	return store.remember(password, profile, days)
}

func (a *App) RestoreEncryptionUnlock(profile string) (*RememberedEncryptionUnlock, error) {
	if !encryptionUnlockSupported {
		return nil, nil
	}
	encryptionUnlockMu.Lock()
	defer encryptionUnlockMu.Unlock()
	store, err := nativeEncryptionUnlockStore()
	if err != nil {
		return nil, err
	}
	return store.restore(profile)
}

func (a *App) ForgetEncryptionUnlock() error {
	if !encryptionUnlockSupported {
		return nil
	}
	encryptionUnlockMu.Lock()
	defer encryptionUnlockMu.Unlock()
	store, err := nativeEncryptionUnlockStore()
	if err != nil {
		return err
	}
	return store.forget()
}
