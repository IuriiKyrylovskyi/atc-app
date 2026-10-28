# 🖥️ Self-Hosted macOS Runner Setup Guide

## Prerequisites

### System Requirements

- **macOS**: 12.0 (Monterey) or later
- **RAM**: Minimum 8GB (16GB+ recommended for iOS builds)
- **Storage**: 50GB+ free space
- **Xcode**: Latest stable version (for iOS builds)
- **Android Studio**: Latest stable version (for Android builds)

---

## 📋 Step 1: Install Required Tools

### 1.1 Install Homebrew (if not installed)

```bash
/bin/bash -c "$(curl -fsSL https://raw.githubusercontent.com/Homebrew/install/HEAD/install.sh)"
```

### 1.2 Install Node.js and PNPM

```bash
# Install Node.js via Homebrew
brew install node@20

# Install PNPM globally
npm install -g pnpm

# Verify installations
node --version
pnpm --version
```

### 1.3 Install Java (for Android builds)

```bash
# Install Temurin JDK 21
brew install --cask temurin@21

# Verify installation
java -version

# Set JAVA_HOME (add to ~/.zshrc or ~/.bash_profile)
echo 'export JAVA_HOME=$(/usr/libexec/java_home -v 21)' >> ~/.zshrc
source ~/.zshrc
```

### 1.4 Install Android SDK

```bash
# Install Android Command Line Tools
brew install --cask android-commandlinetools

# Set ANDROID_HOME (add to ~/.zshrc)
echo 'export ANDROID_HOME=$HOME/Library/Android/sdk' >> ~/.zshrc
echo 'export PATH=$PATH:$ANDROID_HOME/emulator' >> ~/.zshrc
echo 'export PATH=$PATH:$ANDROID_HOME/platform-tools' >> ~/.zshrc
echo 'export PATH=$PATH:$ANDROID_HOME/cmdline-tools/latest/bin' >> ~/.zshrc
source ~/.zshrc

# Create directories and accept licenses
mkdir -p $ANDROID_HOME
yes | sdkmanager --licenses

# Install required SDK components
sdkmanager "platform-tools" "platforms;android-34" "build-tools;34.0.0"
sdkmanager "ndk;26.1.10909125"
```

### 1.5 Install Xcode (for iOS builds)

```bash
# Install Xcode from App Store or:
xcode-select --install

# Accept Xcode license
sudo xcodebuild -license accept

# Install CocoaPods
sudo gem install cocoapods

# Verify
xcodebuild -version
pod --version
```

### 1.6 Install Ruby (for Fastlane - optional but recommended)

```bash
brew install ruby@3.2

# Add to PATH
echo 'export PATH="/opt/homebrew/opt/ruby@3.2/bin:$PATH"' >> ~/.zshrc
source ~/.zshrc

# Verify
ruby --version
```

---

## 🔧 Step 2: Setup GitHub Actions Runner

### 2.1 Register Runner on GitHub

1. Go to your GitHub repository
2. Navigate to: **Settings** → **Actions** → **Runners** → **New self-hosted runner**
3. Select **macOS** as the operating system
4. Follow the provided commands:

(! Follow to Github commands. Current settings are for demo purposes)

```bash
# Create a folder for the runner
mkdir actions-runner && cd actions-runner

# Download the latest runner package
curl -o actions-runner-osx-arm64-2.311.0.tar.gz -L \
  https://github.com/actions/runner/releases/download/v2.311.0/actions-runner-osx-arm64-2.311.0.tar.gz

# Extract the installer
tar xzf ./actions-runner-osx-arm64-2.311.0.tar.gz

# Configure the runner
./config.sh --url https://github.com/YOUR_USERNAME/YOUR_REPO \
  --token YOUR_REGISTRATION_TOKEN \
  --name "macos-mobile-builder" \
  --labels macos,ios,android,mobile \
  --work _work
```

### 2.2 Install Runner as a Service

```bash
# Install the service (runs automatically on boot)
./svc.sh install

# Start the service
./svc.sh start (/actions-runner % ./run.sh)

# Check status
./svc.sh status
```

### 2.3 Verify Runner is Online

- Go back to GitHub: **Settings** → **Actions** → **Runners**
- You should see your runner with a green "Idle" status

---

## 🔐 Step 3: Configure Secrets

Add these secrets in GitHub: **Settings** → **Secrets and variables** → **Actions**

### Android Signing Secrets

1. **ANDROID_KEYSTORE_BASE64**: Base64-encoded keystore file

   ```bash
   # Generate keystore (if you don't have one)
   keytool -genkey -v -keystore atc-app-release.keystore \
     -alias atc-app -keyalg RSA -keysize 2048 -validity 10000

   # Convert to base64
   base64 -i atc-app-release.keystore | pbcopy
   # Paste this into GitHub secret
   ```

2. **ANDROID_KEYSTORE_PASSWORD**: Your keystore password
3. **ANDROID_KEY_ALIAS**: Your key alias (e.g., `atc-app`)
4. **ANDROID_KEY_PASSWORD**: Your key password

### iOS Signing (for production builds)

- **APPLE_CERTIFICATE_BASE64**: Base64-encoded p12 certificate
- **APPLE_CERTIFICATE_PASSWORD**: Certificate password
- **PROVISIONING_PROFILE_BASE64**: Base64-encoded provisioning profile
- **APP_STORE_CONNECT_KEY_ID**: App Store Connect API Key ID
- **APP_STORE_CONNECT_ISSUER_ID**: Issuer ID
- **APP_STORE_CONNECT_PRIVATE_KEY**: Private key (base64)

---

## 🧪 Step 4: Test Your Setup

### 4.1 Test Android Build Locally

```bash
cd your-project-directory

# Install dependencies
pnpm install

# Build web app
pnpm --filter @atc-app/app build

# Sync Capacitor
pnpm --filter @atc-app/mobile exec cap sync android

# Build Android
cd packages/mobile/android
./gradlew assembleDebug
```

### 4.2 Test iOS Build Locally

```bash
# Build web app
pnpm --filter @atc-app/app build

# Sync Capacitor
pnpm --filter @atc-app/mobile exec cap sync ios

# Install pods
cd packages/mobile/ios/App
pod install

# Build iOS
xcodebuild -workspace App.xcworkspace \
  -scheme App \
  -configuration Debug \
  -sdk iphonesimulator
```

---

## 🚀 Step 5: Trigger a Build

### Option 1: Push a Tag

```bash
git tag v1.0.0
git push origin v1.0.0
```

### Option 2: Manual Trigger

1. Go to **Actions** → **Release Pipeline**
2. Click **Run workflow**
3. Enter version number (e.g., `1.0.0`)
4. Click **Run workflow**

---

## 🔍 Troubleshooting

### Runner Not Starting

```bash
# Check logs
cd ~/actions-runner
./svc.sh status
tail -f _diag/Runner_*.log
```

### Android Build Fails

```bash
# Check Gradle version
cd packages/mobile/android
./gradlew --version

# Clear Gradle cache
./gradlew clean
rm -rf ~/.gradle/caches
```

### iOS Build Fails

```bash
# Clean derived data
rm -rf ~/Library/Developer/Xcode/DerivedData

# Update CocoaPods
cd packages/mobile/ios/App
pod repo update
pod install --repo-update
```

### Permission Issues

```bash
# Fix runner permissions
cd ~/actions-runner
sudo chown -R $(whoami) .
```

---

## 📊 Monitoring

### View Runner Logs

```bash
# Real-time logs
cd ~/actions-runner
tail -f _diag/Runner_*.log

# Worker logs
tail -f _diag/Worker_*.log
```

### Check Disk Space

```bash
# Clean up old builds periodically
du -sh ~/actions-runner/_work
rm -rf ~/actions-runner/_work/_temp/*
```

### Restart Runner

```bash
cd ~/actions-runner
./svc.sh stop
./svc.sh start
```

---

## 🎯 Next Steps

1. ✅ Complete all prerequisite installations
2. ✅ Register and start the runner
3. ✅ Configure GitHub secrets
4. ✅ Test builds locally first
5. ✅ Trigger a test release
6. ✅ Monitor the build process
7. ✅ Download and verify artifacts

Your self-hosted runner is now ready to build Android and iOS apps automatically! 🎉
