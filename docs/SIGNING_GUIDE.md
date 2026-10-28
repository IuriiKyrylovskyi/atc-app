# 🔐 Code Signing Guide for ATC-APP

This guide covers code signing setup for production releases across all platforms.

---

## 📋 Table of Contents

1. [Windows Code Signing](#-windows-code-signing)
2. [macOS Code Signing & Notarization](#-macos-code-signing--notarization)
3. [Android APK Signing](#-android-apk-signing)
4. [iOS App Signing](#-ios-app-signing)
5. [GitHub Secrets Setup](#-github-secrets-setup)

---

## 🪟 Windows Code Signing

### Prerequisites

- Windows code signing certificate (`.pfx` or `.p12` file)
- Certificate password

### Local Setup

1. **Obtain Certificate**

   - Purchase from: Sectigo, DigiCert, or Comodo
   - Export as `.pfx` with private key

2. **Update `electron-builder.yml`**

```yaml
win:
  certificateFile: path/to/certificate.pfx
  certificatePassword: ${WIN_CSC_KEY_PASSWORD}
  signingHashAlgorithms: ['sha256']
```

3. **Set Environment Variable**

```bash
   # Windows
   set WIN_CSC_KEY_PASSWORD=your_password_here

   # PowerShell
   $env:WIN_CSC_KEY_PASSWORD="your_password_here"
```

### GitHub Actions Setup

1. **Encode certificate to Base64**

```bash
   certutil -encode certificate.pfx certificate-base64.txt
   # Or on Linux/Mac:
   base64 -i certificate.pfx -o certificate-base64.txt
```

2. **Add GitHub Secrets**

   - `WIN_CSC_LINK`: Base64-encoded certificate
   - `WIN_CSC_KEY_PASSWORD`: Certificate password

3. **Update workflow** (`release.yml`):

```yaml
- name: 📦 Package Windows
  run: pnpm --filter @atc-app/electron exec electron-builder --win --publish never
  env:
    CSC_LINK: ${{ secrets.WIN_CSC_LINK }}
    CSC_KEY_PASSWORD: ${{ secrets.WIN_CSC_KEY_PASSWORD }}
```

---

## 🍎 macOS Code Signing & Notarization

### Prerequisites

- Apple Developer Account ($99/year)
- Developer ID Application certificate
- App-specific password for notarization

### Setup Steps

#### 1. Create Certificates

```bash
# List available certificates
security find-identity -v -p codesigning

# You need: "Developer ID Application: Your Name (TEAM_ID)"
```

#### 2. Create App-Specific Password

1. Visit: https://appleid.apple.com/account/manage
2. Sign in with your Apple ID
3. Security → App-Specific Passwords → Generate
4. Save the password (e.g., `abcd-efgh-ijkl-mnop`)

#### 3. Store Password in Keychain

```bash
xcrun notarytool store-credentials "UATCO_NOTARIZE" \
  --apple-id "your-apple-id@example.com" \
  --team-id "YOUR_TEAM_ID" \
  --password "abcd-efgh-ijkl-mnop"
```

#### 4. Update `electron-builder.yml`

```yaml
mac:
  identity: 'Developer ID Application: Your Name (TEAM_ID)'
  hardenedRuntime: true
  gatekeeperAssess: false
  entitlements: app-build/entitlements.mac.plist
  entitlementsInherit: app-build/entitlements.mac.plist
  notarize:
    teamId: 'YOUR_TEAM_ID'
```

#### 5. Create Entitlements File

**`packages/electron/app-build/entitlements.mac.plist`**:

```xml
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>com.apple.security.cs.allow-jit</key>
  <true/>
  <key>com.apple.security.cs.allow-unsigned-executable-memory</key>
  <true/>
  <key>com.apple.security.cs.allow-dyld-environment-variables</key>
  <true/>
  <key>com.apple.security.cs.disable-library-validation</key>
  <true/>
</dict>
</plist>
```

### GitHub Actions Setup

1. **Export Certificate**

```bash
   # Export from Keychain
   security find-identity -v -p codesigning
   security export -k ~/Library/Keychains/login.keychain-db \
     -t identities -f pkcs12 -P "EXPORT_PASSWORD" \
     -o developer_id.p12

   # Encode to Base64
   base64 -i developer_id.p12 -o certificate-base64.txt
```

2. **Add GitHub Secrets**
   - `MAC_CERTIFICATE`: Base64-encoded `.p12` file
   - `MAC_CERTIFICATE_PASSWORD`: Export password
   - `APPLE_ID`: Your Apple ID email
   - `APPLE_ID_PASSWORD`: App-specific password
   - `APPLE_TEAM_ID`: Your Team ID

---

## 🤖 Android APK Signing

### Generate Keystore

```bash
keytool -genkeypair -v \
  -storetype PKCS12 \
  -keystore atc-app-release.keystore \
  -alias atc-app \
  -keyalg RSA \
  -keysize 2048 \
  -validity 10000 \
  -storepass YOUR_STORE_PASSWORD \
  -keypass YOUR_KEY_PASSWORD \
  -dname "CN=ATC-APP, OU=Development, O=ATC-APP, L=City, ST=State, C=US"
```

### Configure Gradle Signing

**`packages/mobile/android/app/build.gradle`**:

```gradle
android {
    ...
    signingConfigs {
        release {
            if (project.hasProperty('ATC_APP_RELEASE_STORE_FILE')) {
                storeFile file(ATC_APP_RELEASE_STORE_FILE)
                storePassword ATC_APP_RELEASE_STORE_PASSWORD
                keyAlias ATC_APP_RELEASE_KEY_ALIAS
                keyPassword ATC_APP_RELEASE_KEY_PASSWORD
            }
        }
    }
    buildTypes {
        release {
            signingConfig signingConfigs.release
            minifyEnabled true
            proguardFiles getDefaultProguardFile('proguard-android-optimize.txt'), 'proguard-rules.pro'
        }
    }
}
```

### GitHub Actions Setup

1. **Encode Keystore to Base64**

```bash
   base64 -i atc-app-release.keystore -o keystore-base64.txt
```

2. **Add GitHub Secrets**
   - `ANDROID_KEYSTORE_BASE64`: Base64-encoded keystore
   - `ANDROID_KEYSTORE_PASSWORD`: Keystore password
   - `ANDROID_KEY_ALIAS`: Key alias (e.g., `atc-app`)
   - `ANDROID_KEY_PASSWORD`: Key password

---

## 📱 iOS App Signing

### Prerequisites

- Apple Developer Account
- Xcode installed
- iOS Distribution Certificate
- App Store or Ad Hoc provisioning profile

### Setup with Fastlane Match (Recommended)

1. **Install Fastlane**

```bash
   gem install fastlane
   cd packages/mobile/ios
   fastlane init
```

2. **Setup Match**

```bash
   fastlane match init
   # Choose 'git' storage
   # Provide private repo URL for certificates
```

3. **Generate Certificates**

```bash
   fastlane match development
   fastlane match appstore
```

---

## 🔑 GitHub Secrets Setup

### Navigate to Repository Settings

1. Go to: `https://github.com/IuriiKyrylovskyi/atc-app/settings/secrets/actions`
2. Click **"New repository secret"**
3. Add each secret from the tables below

### Required Secrets Summary

#### Android Signing

| Secret Name                 | Description             | Required |
| --------------------------- | ----------------------- | -------- |
| `ANDROID_KEYSTORE_BASE64`   | Base64-encoded keystore | ✅       |
| `ANDROID_KEYSTORE_PASSWORD` | Keystore password       | ✅       |
| `ANDROID_KEY_ALIAS`         | Key alias name          | ✅       |
| `ANDROID_KEY_PASSWORD`      | Key password            | ✅       |

---

**Last Updated**: October 2025
**Maintainer**: @IuriiKyrylovskyi
