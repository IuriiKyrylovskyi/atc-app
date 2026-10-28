<template>
  <Teleport to="body">
    <Transition name="paywall-fade">
      <div v-if="visible" class="paywall-overlay" @click.self="handleBackdropClick">
        <div
          class="paywall-panel"
          :class="{ 'paywall-panel--busy': isBusy }"
          :aria-busy="isBusy"
          @click.capture="blockWhileBusy"
          @beforeinput.capture="blockWhileBusy"
        >
          <div v-if="DEBUG_ENABLED" class="debug-badge" @click="toggleDebugPanel">DEBUG</div>

          <button
            v-if="props.dismissible && !isSyncingAccount"
            class="close-btn"
            @click="handleCloseButtonClick"
          >
            ✕
          </button>

          <div class="panel-header">
            <div class="badge"><span class="badge-dot" /> PRO ACCESS</div>
            <h1 class="headline">Clear For<br /><em>Full Approach</em></h1>
            <p class="subhead">
              Unlock all 20+ airports, hundreds of levels, remove ads, add sync progress across
              devices.
            </p>
            <button
              class="debug-toggle-btn"
              @click="toggleFullDebug"
              title="Show/hide full debug panel"
            >
              {{ showFullDebug ? '🔧 Hide Debug' : '🔧 Show Debug' }}
            </button>

            <!-- Prominent restore entry point. A player who already
                  bought on another platform (or another device) would otherwise fill in credentials and
                  pay twice before they ever scroll far enough to see the restore form.
                  Placed above the credential capture so it is the first thing a
                  returning player sees, and it is a real button (not a link buried at
                  the bottom of the panel). -->
            <div v-if="shouldShowPurchaseForm" class="restore-prominent">
              <div class="package-card featured package-card--static">
                <div class="package-badge">ONE-TIME</div>
                <div class="package-name">Full Access</div>
                <div class="package-price">Unlock All Levels</div>
                <div class="package-desc">All 20+ airports · No ads · Forever</div>
              </div>
            </div>
          </div>

          <!-- Debug panel -->
          <div v-if="DEBUG_ENABLED && showDebugPanel" class="debug-panel">
            <div class="debug-panel-header">
              <strong>Paywall Debug:</strong>
              <button class="debug-clear-btn" @click="clearLogs">Clear</button>
            </div>
            Platform: {{ currentPlatform }}<br />
            isPremium: {{ monetization.isPremium }}<br />
            isNativeMobile: {{ isNativeMobile }}<br />
            Capacitor: {{ hasCapacitor }}<br />
            RC Key: {{ hasRCKeys ? '✅ OK' : '❌ Missing' }}<br />
            RC Key prefix: {{ rcKeyPrefix }}<br />
            RC Initialized: {{ rcInitializedStatus }}<br />
            RC appUserID: {{ rcAppUserIDStatus }}<br />
            Supabase uid: {{ monetization.userId }}<br />
            Account: {{ monetization.accountId ?? '—' }}<br />
            Alias: {{ monetization.userAlias ?? '—' }}<br />
            Password: {{ maskSecret(monetization.userPassword) }}<br />
            Offerings: {{ offeringsStatus }}<br />
            Selected pkg: {{ selectedPackage?.identifier ?? 'none' }}<br />
            current: {{ offerings?.current ? '✅ set' : '❌ null' }}<br />
            <hr style="margin: 8px 0" />
            <strong>Payment Logs (last 50):</strong><br />
            <div class="payment-logs" v-if="paymentLogs.length">
              <div v-for="(log, i) in paymentLogs" :key="i" class="log-entry">{{ log }}</div>
            </div>
            <div v-else class="log-entry" style="color: #888">No logs yet</div>
          </div>

          <!-- Full Debug Panel (always accessible, not gated by DEBUG_ENABLED) -->
          <div v-if="showFullDebug" class="debug-panel debug-panel--full">
            <div class="debug-panel-header">
              <strong>Full Debug Panel:</strong>
              <button class="debug-clear-btn" @click="clearFullDebugLogs">Clear</button>
            </div>

            <div class="debug-section">
              <strong>Monetization Store:</strong><br />
              isPremium: {{ monetization.isPremium }}<br />
              isInitialized: {{ monetization.isInitialized }}<br />
              isLoading: {{ monetization.isLoading }}<br />
              needsRestore: {{ monetization.needsRestore }}<br />
              userId: {{ monetization.userId ?? '—' }}<br />
              accountId: {{ monetization.accountId ?? '—' }}<br />
              userAlias: {{ monetization.userAlias ?? '—' }}<br />
              userPassword: {{ maskSecret(monetization.userPassword) }}<br />
              recoveryWord: {{ maskSecret(monetization.recoveryWord) }}<br />
              platform: {{ monetization.platform }}<br />
              purchaseError: {{ monetization.purchaseError ?? '—' }}<br />
              lastPassedLevel: {{ monetization.lastPassedLevel ?? '—' }}<br />
              passedLevels: {{ JSON.stringify(monetization.passedLevels) }}<br />
              nextLevelToPlay: {{ monetization.nextLevelToPlay }}<br />
            </div>

            <div class="debug-section">
              <strong>LocalStorage (via store):</strong><br />
              storedAlias: {{ storedAlias }}<br />
              storedPassword: {{ maskSecret(storedPassword) }}<br />
            </div>

            <div class="debug-section">
              <strong>RevenueCat State:</strong><br />
              rcInitialized: {{ rcInitializedStatus }}<br />
              rcAppUserID: {{ rcAppUserIDStatus }}<br />
              offeringsStatus: {{ offeringsStatus }}<br />
              selectedPackage: {{ selectedPackage?.identifier ?? 'none' }}<br />
              currentOffering: {{ offerings?.current ? '✅ set' : '❌ null' }}<br />
              packageCount: {{ packageCount }}<br />
              isLoadingOfferings: {{ isLoadingOfferings }}<br />
              purchasesError: {{ purchasesError ?? '—' }}<br />
            </div>

            <div class="debug-section">
              <strong>Platform:</strong><br />
              isNativeMobile: {{ isNativeMobile }}<br />
              hasCapacitor: {{ hasCapacitor }}<br />
              capacitorPlatform: {{ capacitorPlatform }}<br />
              userAgent: {{ userAgent }}<br />
            </div>

            <div class="debug-section">
              <strong>Errors:</strong><br />
              errorMessage: {{ errorMessage ?? '—' }}<br />
              rcError: {{ rcError ?? '—' }}<br />
              ctaMessage: {{ ctaMessage ?? '—' }}<br />
              restoreAliasError: {{ restoreAliasError ?? '—' }}<br />
            </div>

            <div class="debug-section">
              <strong>Sync Status:</strong><br />
              isSyncingAccount: {{ isSyncingAccount }}<br />
              isPurchasing: {{ isPurchasing }}<br />
              isRestoringAlias: {{ isRestoringAlias }}<br />
              showCheckAgain: {{ showCheckAgain }}<br />
              aliasRaceMessage: {{ aliasRaceMessage ?? '—' }}<br />
            </div>

            <div class="debug-section">
              <strong>Inputs State:</strong><br />
              buyAliasInput: {{ buyAliasInput || '—' }}<br />
              buyPasswordInput: {{ maskSecret(buyPasswordInput) }}<br />
              buyConfirmPassword: {{ maskSecret(buyConfirmPassword) }}<br />
              isCredentialsRememberedConfirmed: {{ isCredentialsRememberedConfirmed }}<br />
              restoreAliasInput: {{ restoreAliasInput || '—' }}<br />
              restorePasswordInput: {{ maskSecret(restorePasswordInput) }}<br />
              restoreLostPassword: {{ restoreLostPassword }}<br />
            </div>

            <div class="debug-section">
              <strong>Full Debug Logs:</strong><br />
              <div class="payment-logs" v-if="fullDebugLogs.length">
                <div v-for="(log, i) in fullDebugLogs" :key="i" class="log-entry">{{ log }}</div>
              </div>
              <div v-else class="log-entry" style="color: #888">No logs yet</div>
            </div>
          </div>

          <!-- After purchase: show the public alias + private password -->
          <div v-if="monetization.isPremium && monetization.userAlias" class="key-display">
            <div class="key-display-head">
              <span class="key-display-step">1</span>
              <span class="key-display-headline">Your purchase is confirmed</span>
            </div>
            <p class="key-display-instruction">
              Copy both lines below — you will need them to restore this account on any other
              device. No email or personal data is stored.
            </p>

            <button class="copy-both-btn" @click="copyBoth">
              {{ copyBothLabel }}
            </button>

            <div class="key-display-label">YOUR ACCOUNT ALIAS</div>
            <div class="key-display-value" @click="copyAlias">
              {{ monetization.userAlias }}
              <span class="key-display-copy">{{ aliasCopied ? 'Copied!' : 'Tap to copy' }}</span>
            </div>
            <div class="key-display-label" style="margin-top: 14px">YOUR PASSWORD</div>
            <div class="key-display-value" @click="copyPassword">
              <!-- Masked by default: this screen is a shoulder-surfing risk.
                   Tapping copies the REAL password (copyPassword reads the
                   store, not the mask), so copying is unaffected by the mask. -->
              <div class="key-display-pass-box">
                <span v-if="!passwordVisible" class="key-display-mask">✈✈✈✈✈✈✈✈</span>
                <span v-else>{{ monetization.userPassword }}</span>
                <button
                  class="key-display-eye"
                  :aria-label="passwordVisible ? 'Hide password' : 'Reveal password'"
                  :title="passwordVisible ? 'Hide password' : 'Reveal password'"
                  @click.stop="passwordVisible = !passwordVisible"
                >
                  <i :class="passwordVisible ? 'mdi mdi-eye' : 'mdi mdi-eye-off'"></i>
                </button>
              </div>
              <span class="key-display-copy">{{ passwordCopied ? 'Copied!' : 'Tap to copy' }}</span>
            </div>

            <div class="key-display-steps">
              <span class="key-display-step">2</span>
              <span
                >On another device: open the app, tap <strong>Restore previous purchase</strong>,
                and paste both values.</span
              >
            </div>

            <!-- Recovery word: a free-text second credential for self-service
                 recovery when the alias + password are lost. Shown only when
                 one has been set; the "Set recovery word" control lives on the
                 Premium screen. -->
            <div v-if="monetization.recoveryWord" class="key-display-recovery">
              <div class="key-display-label" style="margin-top: 18px">YOUR RECOVERY WORD</div>
              <div class="key-display-value" @click="copyRecoveryWord">
                {{ monetization.recoveryWord }}
                <span class="key-display-copy">{{
                  recoveryWordCopied ? 'Copied!' : 'Tap to copy'
                }}</span>
              </div>
              <p class="key-display-note">
                A second, free-text credential. If you ever lose your alias and password, enter this
                word on any device to recover your account — no email needed.
              </p>
            </div>

            <p class="key-display-note">
              The alias is public (shown on the leaderboard); the password is private and is the
              only thing that proves ownership. Anyone who only knows the alias cannot restore your
              account.
            </p>
          </div>

          <!-- Loading state while initializing -->
          <div
            v-if="visible && !shouldShowPurchaseForm && !monetization.isPremium"
            class="loading-state"
          >
            <p class="loading-text">Loading...</p>
          </div>

          <!-- Pre-purchase credential capture (required before payment) -->
          <div v-if="shouldShowPurchaseForm" class="credentials-capture">
            <p class="credentials-rules-text" style="margin-bottom: 16px">
              Choose an alias and password before purchase — they are what let you restore this
              account on any other device, with no email. Both must be 8–16 characters, using only
              uppercase A–Z and digits 0–9. No spaces, no <strong>@</strong>, no dots, no special
              characters. We uppercase your input automatically.
            </p>

            <div class="credential-row">
              <input
                v-model="buyAliasInput"
                class="restore-key-input"
                :class="buyAliasClass"
                type="text"
                maxlength="16"
                spellcheck="false"
                autocapitalize="characters"
                placeholder="FANCY YOUR ALIAS"
                @input="onBuyAliasInput"
              />
            </div>
            <!-- Character validation display for alias -->
            <div v-if="buyAliasChars.length > 0" class="char-validation">
              <span
                v-for="c in buyAliasChars"
                :key="c.index"
                :class="['char-badge', c.valid ? 'valid' : 'invalid']"
                >{{ c.char }}</span
              >
            </div>
            <p class="restore-key-hint">{{ buyAliasHint }}</p>

            <div class="credential-row" style="margin-top: 8px">
              <input
                v-model="buyPasswordInput"
                class="restore-key-input"
                :class="passwordClass"
                type="text"
                maxlength="16"
                spellcheck="false"
                autocapitalize="characters"
                placeholder="FANCY YOUR PASSWORD"
              />
            </div>
            <!-- Character validation display for password -->
            <div v-if="buyPasswordChars.length > 0" class="char-validation">
              <span
                v-for="c in buyPasswordChars"
                :key="c.index"
                :class="['char-badge', c.valid ? 'valid' : 'invalid']"
                >{{ c.char }}</span
              >
            </div>

            <div class="credential-row" style="margin-top: 6px">
              <input
                v-model="buyConfirmPassword"
                class="restore-key-input"
                :class="confirmClass"
                type="text"
                maxlength="16"
                spellcheck="false"
                autocapitalize="characters"
                placeholder="CONFIRM YOUR PASSWORD"
              />
            </div>
            <!-- Character validation display for confirm password -->
            <div v-if="buyConfirmChars.length > 0" class="char-validation">
              <span
                v-for="c in buyConfirmChars"
                :key="c.index"
                :class="['char-badge', c.valid ? 'valid' : 'invalid']"
                >{{ c.char }}</span
              >
            </div>
            <p class="restore-key-hint">At least 8 characters.</p>

            <div class="credentials-rules">
              <hr class="credentials-divider" />
            </div>
          </div>

          <!-- Package selection -->
          <div v-if="shouldShowPurchaseForm" class="packages">
            <template v-if="packageCount > 0">
              <!-- One loop, one v-if/v-else per package. v-if and v-for must never share an
                   element in Vue 3: v-if is evaluated first, so `pkg` is undefined there and the
                   render throws as soon as offerings load (native mobile only). -->
              <template v-for="pkg in currentPackages" :key="pkg.identifier">
                <!-- LIFETIME package: static (non-clickable) display -->
                <div
                  v-if="pkg.packageType === 'LIFETIME'"
                  class="package-card featured package-card--static selected"
                >
                  <div class="package-badge">BEST VALUE</div>
                  <div class="package-name">{{ formatPackageName(pkg) }}</div>
                  <div class="package-price">{{ pkg.product.priceString }}</div>
                  <div class="package-desc">{{ formatPackageDesc(pkg) }}</div>
                </div>
                <!-- Non-lifetime packages: clickable buttons -->
                <button
                  v-else
                  class="package-card"
                  :class="{ selected: selectedPackage?.identifier === pkg.identifier }"
                  @click="runAction('unlock', () => selectAndPurchase(pkg))"
                >
                  <div class="package-name">{{ formatPackageName(pkg) }}</div>
                  <div class="package-price">{{ pkg.product.priceString }}</div>
                  <div class="package-desc">{{ formatPackageDesc(pkg) }}</div>
                </button>
              </template>
            </template>
          </div>

          <!-- Inline checkout container for RevenueCat Web SDK (Paddle Billing).
               On web/Electron the Paddle checkout renders into this element.
               Native mobile uses the native RevenueCat SDK and never mounts it. -->
          <div
            v-if="!monetization.isPremium && !isNativeMobile"
            id="rc-web-checkout-container"
            class="rc-web-checkout-container"
          ></div>

          <button
            class="cta-btn"
            :class="{ 'is-pending': pendingAction === 'unlock' }"
            :disabled="ctaDisabled"
            @click="runAction('unlock', handleCtaClick)"
          >
            <span v-if="pendingAction === 'unlock'"
              ><span class="btn-spinner" aria-hidden="true" />Processing...</span
            >
            <span v-else-if="isLoadingOfferings">Loading...</span>
            <span v-else>{{ monetization.isPremium ? 'Continue' : 'Unlock Full Access' }}</span>
          </button>

          <p
            v-if="ctaMessage"
            class="cta-message"
            :class="{ 'cta-message--error': ctaIsError, 'cta-message--success': ctaIsSuccess }"
          >
            {{ ctaMessage }}
          </p>

          <!-- Check again button for neutral pending state -->
          <button
            v-if="showCheckAgain"
            class="check-again-btn"
            @click="runAction('check-again', checkAgain)"
          >
            Check again
          </button>

          <!-- Alias race message -->
          <p v-if="aliasRaceMessage" class="cta-message cta-message--success">
            {{ aliasRaceMessage }}
          </p>

          <!-- Auto-restore: pointless for someone who is already premium, and
                the alias/password block above already shows their credentials. -->
          <template v-if="shouldShowPurchaseForm">
            <div class="continue-free-divider">
              <span class="continue-free-divider-line"></span>
              <span class="continue-free-divider-text">OR</span>
              <span class="continue-free-divider-line"></span>
            </div>

            <button class="restore-prominent-btn" @click="scrollRestoreIntoView">
              <span class="restore-prominent-icon">🔁</span>
              <span class="restore-prominent-text">
                <strong>Already purchased?</strong> Restore your account
              </span>
            </button>
            <p class="restore-prominent-sub">
              Paid on another phone, tablet or computer? Enter your alias and password here — no new
              payment, no email.
            </p>

            <div class="continue-free-divider">
              <span class="continue-free-divider-line"></span>
              <span class="continue-free-divider-text">OR</span>
              <span class="continue-free-divider-line"></span>
            </div>

            <button
              class="restore-btn subtle"
              :class="{ 'is-pending': pendingAction === 'auto-restore' }"
              :disabled="isBusy"
              @click="runAction('auto-restore', handleRestore)"
            >
              <span
                v-if="pendingAction === 'auto-restore'"
                class="btn-spinner"
                aria-hidden="true"
              />Try to restore your data automatically
            </button>
          </template>

          <!-- Cross-device restore by alias + password (anonymous, no email).
                Hidden for premium users: they cannot restore what they own, and
                offering it invites them to overwrite a working account. -->
          <template v-if="shouldShowPurchaseForm">
            <div class="continue-free-divider">
              <span class="continue-free-divider-line"></span>
              <span class="continue-free-divider-text">OR</span>
              <span class="continue-free-divider-line"></span>
            </div>

            <div class="restore-divider" id="restore-section">
              <span class="restore-divider-text">Paid on another device?</span>
            </div>

            <div class="restore-key-row">
              <input
                v-model="restoreAliasInput"
                class="restore-key-input"
                type="text"
                maxlength="16"
                spellcheck="false"
                autocapitalize="characters"
                placeholder="PASTE YOUR 8-16 CHAR ALIAS"
                @keyup.enter="runAction('restore', submitRestoreForm)"
              />
            </div>
            <!-- Character validation display for restore alias -->
            <div v-if="restoreAliasChars.length > 0" class="char-validation">
              <span
                v-for="c in restoreAliasChars"
                :key="c.index"
                :class="['char-badge', c.valid ? 'valid' : 'invalid']"
                >{{ c.char }}</span
              >
            </div>

            <!-- The second credential swaps depending on what the player still
                 has. The alias is required either way, so only the password
                 field is replaced by the recovery word. The word input gets
                 its OWN class because `.restore-key-input` forces uppercase
                 and letter-spacing, which mangles free text. -->
            <template v-if="!restoreLostPassword">
              <div class="restore-key-row" style="margin-top: 6px">
                <input
                  v-model="restorePasswordInput"
                  class="restore-key-input"
                  type="text"
                  maxlength="16"
                  spellcheck="false"
                  autocapitalize="characters"
                  placeholder="PASTE YOUR PASSWORD"
                  @keyup.enter="runAction('restore', submitRestoreForm)"
                />
              </div>
              <!-- Character validation display for restore password -->
              <div v-if="restorePasswordChars.length > 0" class="char-validation">
                <span
                  v-for="c in restorePasswordChars"
                  :key="c.index"
                  :class="['char-badge', c.valid ? 'valid' : 'invalid']"
                  >{{ c.char }}</span
                >
              </div>
            </template>
            <template v-else>
              <div class="restore-key-row" style="margin-top: 6px">
                <input
                  v-model="restorePasswordInput"
                  class="restore-key-input restore-key-input--word"
                  type="text"
                  maxlength="16"
                  spellcheck="false"
                  placeholder="TYPE YOUR RECOVERY WORD"
                  @keyup.enter="runAction('restore', submitRestoreForm)"
                />
              </div>
              <!-- Character validation display for recovery word -->
              <div v-if="recoverWordChars.length > 0" class="char-validation">
                <span
                  v-for="c in recoverWordChars"
                  :key="c.index"
                  :class="['char-badge', c.valid ? 'valid' : 'invalid']"
                  >{{ c.char }}</span
                >
              </div>
            </template>

            <div class="restore-key-row" style="margin-top: 6px">
              <button
                class="restore-key-btn"
                :class="{ 'is-pending': pendingAction === 'restore' }"
                style="width: 100%"
                :disabled="isBusy || !restoreAliasInput.trim() || !restorePasswordInput.trim()"
                @click="runAction('restore', submitRestoreForm)"
              >
                <span v-if="pendingAction === 'restore'" class="btn-spinner" aria-hidden="true" />{{
                  pendingAction === 'restore' ? 'Working...' : 'Restore Account'
                }}
              </button>
            </div>
            <p v-if="restoreAliasError" class="restore-key-error">{{ restoreAliasError }}</p>
            <p v-if="restoreAliasSuccess" class="restore-key-success">
              ✅ Restored — your progress is here.
            </p>

            <!-- Recovery is only useful if a recovery word was ever set, and it
                 is set on the Premium screen — so a free player who reaches
                 here without one is told exactly where to go. -->
            <button class="restore-link-btn" @click="toggleLostPassword">
              {{ restoreLostPassword ? '← I remember my password' : 'I lost my password' }}
            </button>
            <p v-if="restoreLostPassword" class="restore-key-note">
              Enter your alias and the recovery word you set on the Premium screen. We will look up
              your existing password and restore the account here — no email needed.
            </p>
          </template>

          <div class="continue-free-divider">
            <span class="continue-free-divider-line"></span>
            <span class="continue-free-divider-text">OR</span>
            <span class="continue-free-divider-line"></span>
          </div>

          <!-- Free users: escape hatch out of a paywall they cannot afford.
               Premium users: a launcher for the real deletion flow. This does
               NOT delete anything itself — the endpoint and its confirmation
               live on the Profile screen, so there is one destructive flow with
               one confirmation rather than two. -->
          <button class="continue-free-btn" @click="handleLastAction">
            {{ monetization.isPremium ? 'Delete account' : 'I lost my credentials — start fresh' }}
          </button>

          <!-- What "start fresh" actually does. Without this the button reads as
                a downgrade or a wipe, and players hesitate to press it precisely
                when they need it. Free tier only: under "Delete account" it would
                be the opposite of true. -->
          <p v-if="shouldShowPurchaseForm" class="continue-free-note">
            Nothing is deleted. This clears only this device, so you can keep playing without your
            alias and password. Your purchase and progress stay on your account. To get them back,
            restore with your alias and password (or alias and recovery word) from this screen.
          </p>

          <!-- Switch account: available for all users. For free users it is a no-op
                (unlinkDevice returns wasLinked=false) but still scrolls to the
                restore form so they can enter another account's credentials. -->
          <div class="continue-free-divider">
            <span class="continue-free-divider-line"></span>
            <span class="continue-free-divider-text">OR</span>
            <span class="continue-free-divider-line"></span>
          </div>

          <div class="account-actions">
            <button
              class="switch-account-btn"
              :class="{ 'is-pending': pendingAction === 'switch' }"
              :disabled="isBusy"
              @click="runAction('switch', startSwitchAccount)"
            >
              <span v-if="pendingAction === 'switch'" class="btn-spinner" aria-hidden="true" />{{
                pendingAction === 'switch' ? 'Switching...' : 'Switch to another account'
              }}
            </button>

            <div class="continue-free-divider">
              <span class="continue-free-divider-line"></span>
              <span class="continue-free-divider-text">OR</span>
              <span class="continue-free-divider-line"></span>
            </div>

            <button
              v-if="monetization.isPremium"
              class="start-fresh-btn"
              :class="{ 'is-pending': pendingAction === 'start-fresh' }"
              @click="runAction('start-fresh', startFresh)"
            >
              <span
                v-if="pendingAction === 'start-fresh'"
                class="btn-spinner"
                aria-hidden="true"
              />Start fresh (free play)
            </button>

            <div class="credentials-clear">
              <button class="clear-local-btn" @click="clearLocalData">Clear local data</button>
            </div>
          </div>

          <!-- Retry button shown when offerings failed to load on native -->
          <button
            v-if="isNativeMobile && !isLoadingOfferings && packageCount === 0"
            class="retry-btn"
            @click="runAction('retry-offers', loadOfferings)"
          >
            Retry loading offers
          </button>

          <div v-if="errorMessage" class="error-banner">{{ errorMessage }}</div>

          <!-- Legal links. Only the browser build gets them — the web checkout
                page has to carry the terms, the privacy policy and the refund
                policy. The native stores and the desktop app point the user at
                their own listing instead. -->
          <nav v-if="showLegalLinks" class="legal-links" aria-label="Legal">
            <a
              v-for="link in legalLinks"
              :key="link.url"
              class="legal-link"
              :href="link.url"
              target="_blank"
              rel="noopener noreferrer"
              @click.prevent="openLegalLink(link.url)"
            >
              {{ link.label }}
            </a>
          </nav>

          <!-- Disclaimer modal: shown once per paywall session before purchase -->
          <Teleport to="body">
            <Transition name="paywall-fade">
              <div v-if="showDisclaimerModal" class="paywall-overlay" @click.self="closeDisclaimer">
                <div class="disclaimer-card">
                  <h2 class="disclaimer-title">Remember your credentials</h2>
                  <p class="disclaimer-body">
                    We do not use, trace, keep, or store any personal user data. We just provide a
                    game uniqueness to our players. Please remember your alias
                    <strong>{{ buyAliasInput }}</strong> and password
                    <strong>{{ buyPasswordInput }}</strong> to be able to continue with your premium
                    state on other devices. The consequences of losing this data are completely on
                    your side. And we would like to help you if any trouble but we really don't know
                    who you are.
                  </p>
                  <div class="disclaimer-actions">
                    <button class="disclaimer-btn disclaimer-disreagard" @click="closeDisclaimer">
                      Disregard
                    </button>
                    <button
                      class="disclaimer-btn disclaimer-roger"
                      @click="runAction('unlock', confirmCredentials)"
                    >
                      Roger
                    </button>
                  </div>
                </div>
              </div>
            </Transition>
          </Teleport>

          <!-- Sync overlay: blocks all interaction while waiting for server to confirm account -->
          <div v-if="isSyncingAccount" class="sync-overlay" @click.stop @keydown.esc.prevent>
            <div class="sync-modal">
              <div class="sync-spinner" />
              <p class="sync-title">Setting up your account…</p>
              <p class="sync-body">
                We’ve received your payment and are waiting for the server to confirm your premium
                account. This usually takes a few seconds.
              </p>
              <p class="sync-hint">Please do not close the app.</p>
            </div>
          </div>
        </div>
      </div>
    </Transition>
  </Teleport>
</template>

<script setup lang="ts">
import { ref, computed, watch, toRaw, nextTick, onBeforeUnmount } from 'vue';
import { maskSecret } from '@/lib/redact';
import { paywallBusy } from '@/lib/paywallBusy';
import { useRouter } from 'vue-router';
import { useMonetizationStore } from '@/stores/monetization';
import { useDebugStore } from '@/stores/debug';
import { usePurchases } from '@/composables/usePurchases';
import { RevenueCatService, getPaymentLogs, clearPaymentLogs } from '@/services/revenueCatService';
import { Capacitor } from '@capacitor/core';
import type { PurchasesPackage } from '@revenuecat/purchases-capacitor';
import { supabase } from '@/lib/supabase';
import { isPlainWeb } from '@/utils/platform';
import {
  validateAlias,
  validatePassword,
  validateConfirm,
  validateWord,
  validateAliasVsPassword,
  validateWordVsAlias,
  tooManyAttemptsMessage,
} from '@/lib/credentialRules';
import { ENV } from '@/config/env';

// ── iOS viewport zoom guard ────────────────────────────────────────────────────
// iOS Safari auto-zooms the viewport to any focused <input> whose computed
// font-size is below 16 CSS px, and leaves the zoom stuck after the field is
// blurred. The paywall's alias/password/confirm inputs used to sit at 14px,
// so focusing them zoomed the whole document — menus, strips, text — and the
// zoom survived the paywall closing. Two layers defend against it:
//   1. index.html ships maximum-scale=1.0,user-scalable=no (permissive meta
//      replaced at the source, so it applies on pages where the game never
//      boots and never rewrites the meta).
//   2. This helper re-asserts the non-zoomable meta and resets scroll on close.
const VIEWPORT_META =
  'width=device-width,initial-scale=1.0,maximum-scale=1.0,user-scalable=no,viewport-fit=cover';

function resetViewportMeta(): void {
  let vp = document.querySelector('meta[name=viewport]') as HTMLMetaElement | null;
  if (!vp) {
    vp = document.createElement('meta');
    vp.setAttribute('name', 'viewport');
    document.head.appendChild(vp);
  }
  vp.setAttribute('content', VIEWPORT_META);
  window.scrollTo(0, 0);
}

// Server validation endpoint removed — format checks are local, alias availability uses RPC

// ── Local validation state ───────────────────────────────────────────────────────
const validation = ref<{
  alias?: { valid: boolean; error?: string };
  password?: { valid: boolean; error?: string };
  confirm?: { valid: boolean; error?: string };
  aliasAvailable?: boolean;
  checking?: boolean;
}>({});

// ── Props / Emits ──────────────────────────────────────────────────────────────
const props = withDefaults(
  defineProps<{
    visible?: boolean;
    dismissible?: boolean;
    // 'restore' opens the panel scrolled to the alias + password restore form
    // (used after "Switch to another account").
    focus?: 'restore' | null;
  }>(),
  {
    visible: false,
    dismissible: true,
    focus: null,
  }
);

const emit = defineEmits<{ close: []; purchased: [] }>();

// ── Stores & composables ───────────────────────────────────────────────────────
const router = useRouter();
const monetization = useMonetizationStore();
const debugStore = useDebugStore();

const purchases = usePurchases();
const offerings = purchases.offerings;
const isLoadingOfferings = purchases.loading;
const purchasesError = purchases.error;
const loadPurchasesOfferings = purchases.loadOfferings;
const purchasePackage = purchases.purchasePackage;
const purchasesRestore = purchases.restorePurchases;

// ── Local state ────────────────────────────────────────────────────────────────
/**
 * Build-time debug flag. Only true when VITE_SHOW_DEBUG=true at build time.
 * Never set it in .env.local / production env files: when it is unset Vite
 * replaces it with undefined and the debug UI is stripped from the bundle.
 */
const DEBUG_ENABLED = ENV.VITE_SHOW_DEBUG === 'true';
const showDebugPanel = ref(false);

const showFullDebug = ref(false); // Always accessible debug panel (not gated by DEBUG_ENABLED)
/** Recovery password is masked until the player asks to see it. */
const passwordVisible = ref(false);
const selectedPackage = ref<PurchasesPackage | null>(null);
const isPurchasing = ref(false);
const errorMessage = ref<string | null>(null);
const rcError = ref<string | null>(null);
const restoreAliasInput = ref('');
const restorePasswordInput = ref('');
const isRestoringAlias = ref(false);
const restoreAliasError = ref<string | null>(null);
const restoreAliasSuccess = ref(false);
// Swaps the password field for a recovery-word field. The alias stays either
// way: recovery needs BOTH, so only the second credential is replaced.
const restoreLostPassword = ref(false);
const recoveryWordCopied = ref(false);
const aliasCopied = ref(false);
const passwordCopied = ref(false);
const copyBothLabel = ref('Copy both — alias + password');

const ctaMessage = ref<string | null>(null);
const ctaIsError = ref(false);
const ctaIsSuccess = ref(false);
const showCheckAgain = ref(false);
const aliasRaceMessage = ref<string | null>(null);

// Pre-purchase credential capture.
const buyAliasInput = ref('');
const buyPasswordInput = ref('');
const buyConfirmPassword = ref('');
const isCredentialsRememberedConfirmed = ref(false);
const showDisclaimerModal = ref(false);
const isSyncingAccount = ref(false);
const isSwitchingAccount = ref(false);

// ── Busy state ──────────────────────────────────────────────────────────────────
// While a request started here waits for its answer, the paywall ignores every
// touch: it cannot be closed, no other button runs, the inputs cannot change, and
// the pressed button shows a spinner. The panel still scrolls. The web checkout
// container is the exception: the player has to use it during a web purchase, and
// it has its own cancel.
type PaywallAction =
  | 'unlock'
  | 'auto-restore'
  | 'restore'
  | 'switch'
  | 'start-fresh'
  | 'check-again'
  | 'retry-offers';
const pendingAction = ref<PaywallAction | null>(null);
const isBusy = computed(
  () =>
    pendingAction.value !== null ||
    isPurchasing.value ||
    isRestoringAlias.value ||
    isSyncingAccount.value ||
    isSwitchingAccount.value
);
// Android Back (App.vue) checks this. Several screens mount a paywall, so only the
// instance that set it clears it.
watch(isBusy, (busy) => {
  paywallBusy.value = busy;
});
onBeforeUnmount(() => {
  if (isBusy.value) paywallBusy.value = false;
});

async function runAction(action: PaywallAction, fn: () => unknown): Promise<void> {
  if (isBusy.value) return;
  pendingAction.value = action;
  // Hide the keyboard so the spinner and the answer are visible.
  (document.activeElement as HTMLElement | null)?.blur?.();
  try {
    await fn();
  } finally {
    pendingAction.value = null;
  }
}

/** Capture-phase guard on the panel: drops clicks and typing while a request runs. */
function blockWhileBusy(event: Event): void {
  if (!isBusy.value) return;
  if (event.target instanceof Element && event.target.closest('#rc-web-checkout-container')) {
    return;
  }
  event.preventDefault();
  event.stopPropagation();
}

const buyAliasState = ref<'idle' | 'checking' | 'available' | 'taken' | 'error'>('idle');
const buyAliasHint = ref('At least 8 characters.');
let buyAliasProbeTimer: ReturnType<typeof setTimeout> | null = null;

// ── Computed ───────────────────────────────────────────────────────────────────
const hasCapacitor = computed(() => !!window.Capacitor);
const isNativeMobile = computed(() => Capacitor.isNativePlatform());
const currentPlatform = computed(() => monetization.platform);

// ── Legal links (browser only) ─────────────────────────────────────────────────
/**
 * Terms / privacy / refund. Only the browser build gets them: the web checkout
 * page has to carry the links, while the native stores and the desktop app
 * point the user at their own listing.
 *
 * `isPlainWeb()` is a plain (non-reactive) boolean — the runtime cannot change
 * during a session, and `window.electronAPI` is already in place when this
 * component is set up (the Electron preload runs before the app's JS).
 */
const showLegalLinks = isPlainWeb();

const legalLinks = [
  { label: 'Terms of Service', url: 'https://iuriikyrylovskyi.github.io/atc-app-terms/' },
  { label: 'Privacy Policy', url: 'https://iuriikyrylovskyi.github.io/atc-app-privacy/' },
  { label: 'Refund Policy', url: 'https://iuriikyrylovskyi.github.io/atc-app-refund/' },
];

/**
 * Open a legal document in a new tab.
 *
 * The href is kept on the anchor so the link stays a real, copyable link
 * (long-press → copy) — only the navigation itself is intercepted, so the
 * browser opens a normal new tab.
 */
function openLegalLink(url: string): void {
  window.open(url, '_blank', 'noopener,noreferrer');
}

// ── Character-level validation (visual feedback) ───────────────────────────────
// Allowed chars for alias/password: A-Z, 0-9
const ALLOWED_ALIAS_PASSWORD = /^[A-Z0-9]$/;
// Allowed chars for recovery word: A-Z, 0-9
const ALLOWED_WORD = /^[A-Z0-9]$/;

interface CharValidation {
  char: string;
  valid: boolean;
  index: number;
}

const buyAliasChars = computed<CharValidation[]>(() => {
  const val = buyAliasInput.value.toUpperCase();
  return val.split('').map((char, index) => ({
    char,
    valid: ALLOWED_ALIAS_PASSWORD.test(char),
    index,
  }));
});

const buyPasswordChars = computed<CharValidation[]>(() => {
  const val = buyPasswordInput.value.toUpperCase();
  return val.split('').map((char, index) => ({
    char,
    valid: ALLOWED_ALIAS_PASSWORD.test(char),
    index,
  }));
});

const buyConfirmChars = computed<CharValidation[]>(() => {
  const val = buyConfirmPassword.value.toUpperCase();
  return val.split('').map((char, index) => ({
    char,
    valid: ALLOWED_ALIAS_PASSWORD.test(char),
    index,
  }));
});

const restoreAliasChars = computed<CharValidation[]>(() => {
  const val = restoreAliasInput.value.toUpperCase();
  return val.split('').map((char, index) => ({
    char,
    valid: ALLOWED_ALIAS_PASSWORD.test(char),
    index,
  }));
});

const restorePasswordChars = computed<CharValidation[]>(() => {
  const val = restorePasswordInput.value.toUpperCase();
  return val.split('').map((char, index) => ({
    char,
    valid: ALLOWED_ALIAS_PASSWORD.test(char),
    index,
  }));
});

const recoverWordChars = computed<CharValidation[]>(() => {
  const val = restorePasswordInput.value.toUpperCase(); // uses same input field
  return val.split('').map((char, index) => ({
    char,
    valid: ALLOWED_WORD.test(char),
    index,
  }));
});

const buyAliasClass = computed(() => {
  if (buyAliasInput.value === '') return '';
  if (validation.value.aliasAvailable) return 'restore-key-input--available';
  if (validation.value.alias?.error === 'alias_taken') return 'restore-key-input--taken';
  if (validation.value.checking) return 'restore-key-input--checking';
  if (validation.value.alias?.error) return 'restore-key-input--error';
  return '';
});

const passwordClass = computed(() => {
  if (buyPasswordInput.value === '') return '';
  if (validation.value.password?.valid) return 'restore-key-input--available';
  return 'restore-key-input--error';
});

const confirmClass = computed(() => {
  if (buyConfirmPassword.value === '') return '';
  if (validation.value.confirm?.valid) return 'restore-key-input--available';
  return 'restore-key-input--error';
});

const aliasFormatValid = computed(() => validation.value.alias?.valid ?? false);
const aliasAvailable = computed(() => validation.value.aliasAvailable ?? false);
const passwordFormatValid = computed(() => validation.value.password?.valid ?? false);
const passwordMatch = computed(() => validation.value.confirm?.valid ?? false);
const inputsValid = computed(
  () =>
    aliasFormatValid.value &&
    aliasAvailable.value &&
    passwordFormatValid.value &&
    passwordMatch.value
);

/**
 * Primary CTA disabled state. Mirrors the guards in handlePrimaryAction()
 * so the button never promises a click that the handler will reject:
 *   1. inputsValid — alias format + availability + password format + confirm match
 *   2. (mobile only) a package must be selected / loaded
 *
 * The previous inline expression guarded the whole credential check behind
 * `isNativeMobile`, so on web/electron the clause short-circuited to `false`
 * and the button was never disabled — a player could click "Unlock Full Access"
 * with an empty or malformed alias/password.
 */
const ctaDisabled = computed(() => {
  if (isPurchasing.value || isLoadingOfferings.value || isSyncingAccount.value) return true;
  if (monetization.isPremium) return false;
  if (!inputsValid.value) return true;
  if (isNativeMobile.value && !selectedPackage.value && packageCount.value === 0) {
    return true;
  }
  return false;
});

/**
 * On native mobile, wait for monetization.init() to complete before showing
 * the purchase form. This prevents a "flash" of the purchase UI when the user
 * already has a cached Play Store purchase (isPremium flips true after init).
 * On web/electron, show immediately since there's no native init delay.
 */
const shouldShowPurchaseForm = computed(() => {
  if (monetization.isPremium) return false;
  if (isNativeMobile.value && !monetization.isInitialized) return false;
  return true;
});

const currentPackages = computed<PurchasesPackage[]>(() => {
  const fromCurrent = offerings.value?.current?.availablePackages ?? [];
  if (fromCurrent.length > 0) return fromCurrent;

  const all = offerings.value?.all ?? {};
  for (const key of Object.keys(all)) {
    const pkgs = (all as any)[key]?.availablePackages ?? [];
    if (pkgs.length > 0) return pkgs;
  }
  return [];
});

const packageCount = computed(() => currentPackages.value.length);

const hasRCKeys = computed(() => {
  const platform = Capacitor.getPlatform();
  const key =
    platform === 'ios'
      ? (ENV.VITE_RC_IOS_KEY as string)
      : (ENV.VITE_RC_ANDROID_KEY as string);
  return !!key && key.length > 20 && !key.includes('YOUR');
});

// ── Watchers for local validation ────────────────────────────────────────────────
watch(
  () => buyPasswordInput.value,
  (val) => {
    const upper = val.toUpperCase();
    if (upper !== val) buyPasswordInput.value = upper;

    const pwdResult = validatePassword(upper);
    validation.value.password = pwdResult.valid
      ? { valid: true }
      : { valid: false, error: pwdResult.error };

    // Also validate confirm if it has a value
    if (buyConfirmPassword.value) {
      const confResult = validateConfirm(upper, buyConfirmPassword.value.toUpperCase());
      validation.value.confirm = confResult.valid
        ? { valid: true }
        : { valid: false, error: confResult.error };
    }
    // Cross-check alias vs password
    if (buyAliasInput.value) {
      const crossResult = validateAliasVsPassword(buyAliasInput.value, upper);
      if (!crossResult.valid) {
        validation.value.password = { valid: false, error: crossResult.error };
      }
    }
  },
  { immediate: false }
);

watch(
  () => buyConfirmPassword.value,
  (val) => {
    const upper = val.toUpperCase();
    if (upper !== val) buyConfirmPassword.value = upper;

    const confResult = validateConfirm(buyPasswordInput.value.toUpperCase(), upper);
    validation.value.confirm = confResult.valid
      ? { valid: true }
      : { valid: false, error: confResult.error };
  },
  { immediate: false }
);

const rcKeyPrefix = computed(() => {
  const platform = Capacitor.getPlatform();
  const key =
    platform === 'ios'
      ? (ENV.VITE_RC_IOS_KEY as string)
      : (ENV.VITE_RC_ANDROID_KEY as string);
  if (!key) return 'undefined';
  return `${key.slice(0, 12)}... (${key.length} chars)`;
});

const rcInitializedStatus = computed(() => (monetization.isInitialized ? '✅ Yes' : '❌ No'));
const rcAppUserID = ref<string | null>(null);
const rcAppUserIDStatus = computed(() => {
  if (!isNativeMobile.value) return 'n/a (web)';
  if (rcAppUserID.value === null) return '…loading';
  // rcAppUserID IS the private recovery password (by design — see
  // RevenueCatService.logIn docs) — never render it unmasked, even here.
  const id = rcAppUserID.value;
  return id.length > 8 ? `${id.slice(0, 4)}••••${id.slice(-4)}` : '••••••••';
});

const offeringsStatus = computed(() => {
  if (isLoadingOfferings.value) return 'Loading...';
  if (!offerings.value) return 'null — see RC Error above';
  if (!offerings.value.current)
    return 'Offerings object received but current is null. Check RC dashboard → set default offering.';
  return `Loaded (${packageCount.value} packages)`;
});

// ─── Full Debug Panel Computed ───────────────────────
const storedAlias = computed(() => monetization.loadStoredAlias());
const storedPassword = computed(() => monetization.loadStoredPassword());
const capacitorPlatform = computed(() => Capacitor.getPlatform());
// Templates cannot reach browser globals such as `navigator`.
const userAgent = typeof navigator !== 'undefined' ? navigator.userAgent : '';

// Full debug logs (separate from payment logs)
const fullDebugLogs = ref<string[]>([]);

function addFullDebugLog(msg: string): void {
  const timestamp = new Date().toISOString().split('T')[1].split('.')[0];
  fullDebugLogs.value.unshift(`[${timestamp}] ${msg}`);
  if (fullDebugLogs.value.length > 100) fullDebugLogs.value.pop();
  try {
    debugStore.info(msg);
  } catch (e) {
    // ignore
  }
}

function clearFullDebugLogs(): void {
  fullDebugLogs.value = [];
}

// Payment logs for debug panel (reactive via getter)
const paymentLogs = computed(() => getPaymentLogs());

// The tap that opens the paywall can be delivered again as a click on the freshly
// mounted overlay on touch devices, which would dismiss it instantly. Ignore backdrop
// clicks for a short window after opening.
let openedAt = 0;
const BACKDROP_GRACE_MS = 500;

// ── Load offerings when paywall becomes visible ────────────────────────────────
watch(
  () => props.visible,
  async (isVisible) => {
    debugStore.info('Paywall.vue: visibility changed', { visible: isVisible });
    debugStore.setPaywallVisible(!!isVisible);
    if (isVisible) openedAt = Date.now();
    console.log('🎭 Paywall visibility changed:', isVisible ? 'OPEN' : 'CLOSE');
    if (!isVisible) {
      debugStore.info('Paywall.vue: closing - resetting input state');
      console.log('🔄 Paywall CLOSED - resetting input state');
      // Reset alias/password inputs when paywall closes
      buyAliasInput.value = '';
      buyPasswordInput.value = '';
      buyConfirmPassword.value = '';
      isCredentialsRememberedConfirmed.value = false;
      buyAliasState.value = 'idle';
      buyAliasHint.value = 'At least 8 characters.';
      showCheckAgain.value = false;
      aliasRaceMessage.value = null;
      if (buyAliasProbeTimer) {
        clearTimeout(buyAliasProbeTimer);
        buyAliasProbeTimer = null;
      }

      // iOS leaves the viewport zoomed after focusing an input. Even with
      // the non-zoomable meta in index.html, re-assert it here and reset
      // scroll so a stuck zoom snaps back to 1.0 the moment the overlay
      // disappears (see docs/TODO.md:73).
      resetViewportMeta();
    } else {
      console.log('🎭 Paywall OPEN - loading offerings (native:', isNativeMobile.value, ')');
      if (props.focus === 'restore') void scrollToRestoreForm();
    }
    if (!isVisible || !isNativeMobile.value) return;
    await loadOfferings();
  },
  { immediate: true }
);

/**
 * Scrolls to the restore form once it is rendered. Unlike scrollRestoreIntoView
 * it never falls back to an automatic store restore: the player came here to
 * type another account's credentials.
 */
async function scrollToRestoreForm(): Promise<void> {
  for (let attempt = 0; attempt < 20; attempt++) {
    await nextTick();
    const el = document.getElementById('restore-section');
    if (el) {
      debugStore.info('Paywall.vue: scrolled to the restore form', { attempt });
      el.scrollIntoView({ behavior: 'smooth', block: 'start' });
      return;
    }
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  debugStore.warn('Paywall.vue: restore form not rendered, could not scroll to it');
}

async function loadOfferings() {
  debugStore.info('Paywall.vue: loadOfferings called');
  if (!isNativeMobile.value) return;

  errorMessage.value = null;
  rcError.value = null;

  try {
    if (!monetization.isInitialized) {
      await monetization.init();
    }

    await new Promise((r) => setTimeout(r, 300));

    rcAppUserID.value = await RevenueCatService.getAppUserID();

    await loadPurchasesOfferings();
    debugStore.info('Paywall.vue: offerings loaded', {
      hasCurrent: !!offerings.value?.current,
      packageCount: currentPackages.value.length,
    });

    rcError.value = purchasesError.value;

    if (!offerings.value) {
      errorMessage.value = rcError.value
        ? `RC Error: ${rcError.value}`
        : 'Could not load offerings. Check RC dashboard: product status and App Store shared secret.';
      return;
    }

    if (packageCount.value === 0) {
      errorMessage.value =
        'Offering loaded but has no packages. Check RC dashboard → Offerings → attach packages.';
      return;
    }

    selectedPackage.value =
      toRaw(currentPackages.value.find((p: PurchasesPackage) => p.packageType === 'LIFETIME')) ||
      toRaw(currentPackages.value[0]);

    console.log('✅ Selected package:', selectedPackage.value?.identifier);
  } catch (e) {
    rcError.value = e instanceof Error ? e.message : String(e);
    errorMessage.value = `RevenueCat error: ${rcError.value}`;
    console.error('RevenueCat getOfferings error:', e);
  }
}

// ── Handlers ───────────────────────────────────────────────────────────────────
function buyAliasHintRed(value: string): boolean {
  if (!value) return false;
  if (!/^[A-Z0-9]+$/.test(value)) return true;
  return false;
}

function toggleDebugPanel() {
  if (!DEBUG_ENABLED) return;
  showDebugPanel.value = !showDebugPanel.value;
}

function toggleFullDebug() {
  showFullDebug.value = !showFullDebug.value;
  addFullDebugLog(showFullDebug.value ? 'Full debug panel OPENED' : 'Full debug panel CLOSED');
}

function clearLogs() {
  clearPaymentLogs();
}

function handleCloseButtonClick() {
  if (isBusy.value) return;
  debugStore.info('Paywall.vue: emit close', {
    source: 'handleCloseButtonClick',
    stack: new Error().stack?.split('\n').slice(1, 4).join(' > '),
  });
  emit('close');
}

function handleBackdropClick() {
  if (Date.now() - openedAt < BACKDROP_GRACE_MS) {
    debugStore.info('Paywall.vue: backdrop click ignored (opening grace period)');
    return;
  }
  if (isBusy.value) {
    debugStore.info('Paywall.vue: backdrop click ignored (request in progress)');
    return;
  }
  debugStore.info('Paywall.vue: backdrop clicked, emitting close');
  if (props.dismissible) {
    debugStore.info('Paywall.vue: emit close', {
      source: 'handleBackdropClick',
      stack: new Error().stack?.split('\n').slice(1, 4).join(' > '),
    });
    emit('close');
  }
}

function formatPackageName(pkg: PurchasesPackage) {
  return pkg.packageType === 'LIFETIME' ? 'Lifetime Access' : pkg.product.title ?? pkg.identifier;
}

function formatPackageDesc(pkg: PurchasesPackage) {
  return pkg.packageType === 'LIFETIME' ? 'All 20+ airports · No ads · Forever' : '';
}

async function selectAndPurchase(pkg: PurchasesPackage) {
  selectedPackage.value = toRaw(pkg);
  await handlePurchase(selectedPackage.value);
}

/**
 * After a purchase the account the player ends up with can differ from what they typed:
 *  - alias race: the alias was taken, the webhook generated another one (password is theirs);
 *  - existing account: the store purchase already belonged to an older account, so the
 *    webhook re-linked THAT account (TRANSFER) and ignored the alias/password just typed.
 * The second case must say so, otherwise the player holds credentials they never chose.
 */
function accountNoticeAfterPurchase(typedAlias: string, typedPassword: string): string | null {
  const serverAlias = monetization.userAlias;
  const serverPassword = monetization.userPassword;
  if (!serverAlias) return null;
  if (serverPassword && serverPassword !== typedPassword) {
    return `This purchase already belongs to the account ${serverAlias} (from an earlier setup with this store account), so you are signed in to it. On other devices use alias ${serverAlias} and that account's own password (shown on the Premium account screen). The alias and password you just typed were not used.`;
  }
  if (serverAlias !== typedAlias) {
    // Ambiguous from the client alone: either the typed alias was taken (alias race) or the
    // purchase already belonged to an older account whose password happens to equal the typed
    // one. A message that is true in both cases:
    return `You are signed in to the account ${serverAlias}, not the alias you typed. Either that alias was already taken, or this purchase already belonged to this earlier account. Use alias ${serverAlias} on other devices; its password is shown on the Premium account screen.`;
  }
  return null;
}

async function handlePurchase(pkg: PurchasesPackage) {
  if (isPurchasing.value) return;
  errorMessage.value = null;
  isPurchasing.value = true;

  console.log('🚀 Starting purchase for:', pkg.identifier);

  try {
    // 1. Set alias/password as subscriber attributes (skm_alias, skm_secret)
    // This ensures the webhook receives them to create the account on purchase.
    // `user_id` tells the webhook which device bought, so it can link this
    // profile to the new account and hand it the first play session.
    // RC appUserID is the device Supabase uid (set in monetization.init) until Phase 4.
    const alias = buyAliasInput.value.trim().toUpperCase();
    const password = buyPasswordInput.value.trim().toUpperCase();
    await RevenueCatService.setAttributes({
      skm_alias: alias,
      skm_secret: password,
      user_id: monetization.userId ?? '',
    });

    debugStore.info('Paywall.vue: calling purchasePackage', { packageId: pkg.identifier });
    const result = await purchasePackage(pkg);
    debugStore.info('Paywall.vue: purchasePackage result', {
      success: result.success,
      error: result.error,
    });

    if (result.success) {
      console.log('✅ Purchase successful');

      // The revenuecat-webhook creates the account (is_premium = true) from the
      // alias/password subscriber attributes. Stay in the "Processing..." state
      // until the app has received that account, then close the paywall.
      isSyncingAccount.value = true;
      try {
        const accountReady = await waitForPremiumAccount();
        if (accountReady) {
          // The account may differ from what the player typed (alias race, or the
          // purchase already belonged to an existing account). Tell them which.
          const notice = accountNoticeAfterPurchase(
            buyAliasInput.value.trim().toUpperCase(),
            buyPasswordInput.value.trim().toUpperCase()
          );
          if (notice) {
            aliasRaceMessage.value = notice;
            await new Promise((r) => setTimeout(r, 7000));
          }
          emit('purchased');
          debugStore.info('Paywall.vue: emit close', {
            source: 'handlePurchase',
            stack: new Error().stack?.split('\n').slice(1, 4).join(' > '),
          });
          emit('close');
        } else {
          ctaMessage.value = 'Purchase confirmed with the store. Finishing setup…';
          ctaIsError.value = false;
          ctaIsSuccess.value = true;
          showCheckAgain.value = true;
        }
      } finally {
        isSyncingAccount.value = false;
      }
    } else if (result.alreadyOwned) {
      // The store says this account already owns Pro. Retrying the payment can never
      // work, so link the existing purchase to an account instead of showing an error.
      // Inputs are kept: they are needed to create the account if none exists yet.
      await claimExistingPurchase(alias, password);
    } else {
      // Purchase failed/cancelled - clear inputs, show error
      if (result.cancelled) {
        ctaMessage.value = 'Purchase cancelled.';
      } else {
        ctaMessage.value = result.error ?? 'Store returned no error, but success was false.';
      }
      ctaIsError.value = true;
      // Clear alias/password inputs on failure
      buyAliasInput.value = '';
      buyPasswordInput.value = '';
      buyConfirmPassword.value = '';
      isCredentialsRememberedConfirmed.value = false;
    }
  } catch (e) {
    const catchError = e instanceof Error ? e.message : String(e);
    ctaMessage.value = `Unexpected error: ${catchError}`;
    ctaIsError.value = true;
    console.error('handlePurchase exception:', e);
  } finally {
    isPurchasing.value = false;
  }
}

/** Player-facing text for each outcome of monetization.claimPurchase(). */
function getClaimErrorMessage(error?: string): string {
  switch (error) {
    case 'not_entitled':
      return 'The store does not show a Pro purchase for this account. If you paid with another Google account, use "Paid on another device?" below.';
    case 'alias_taken':
      return 'That alias is already taken — pick another one.';
    case 'credentials_unavailable':
      return 'Those credentials are not available — change your alias or password and try again.';
    case 'invalid_credentials':
      return 'Alias and password must be 8–16 characters (A–Z, 0–9) and different from each other.';
    case 'already_linked':
      return 'This device is already linked to a different account.';
    case 'network':
      return 'Could not reach the server. Check your connection and tap Unlock Full Access again.';
    default:
      return 'Could not link your purchase. Please try again.';
  }
}

/**
 * The store already owns the product for this account ("already active"), so the
 * purchase exists but may have no account. Ask the server to claim it.
 *
 * Failure keeps the alias/password the player typed and re-arms the "remember your
 * credentials" confirmation, because they will usually edit one before trying again.
 */
async function claimExistingPurchase(alias: string, password: string): Promise<void> {
  debugStore.info('Paywall.vue: purchase already owned - claiming', { alias });
  ctaMessage.value = null;
  ctaIsError.value = false;
  ctaIsSuccess.value = false;
  isSyncingAccount.value = true;

  try {
    const result = await monetization.claimPurchase(alias, password);
    debugStore.info('Paywall.vue: claimPurchase result', {
      success: result.success,
      error: result.error,
    });

    if (!result.success) {
      ctaMessage.value = getClaimErrorMessage(result.error);
      ctaIsError.value = true;
      isCredentialsRememberedConfirmed.value = false;
      if (result.error === 'alias_taken') {
        validation.value.alias = { valid: false, error: 'alias_taken' };
        validation.value.aliasAvailable = false;
      }
      return;
    }

    // An account may already have existed for this purchase under another alias.
    if (result.alias && result.alias !== alias) {
      aliasRaceMessage.value = `This purchase already had an account, so your alias is ${result.alias}. You can change it in settings.`;
      await new Promise((r) => setTimeout(r, 3000));
    }
    emit('purchased');
    emit('close');
  } finally {
    isSyncingAccount.value = false;
  }
}

/**
 * After a successful store payment, poll until the webhook-created account has
 * reached the app (isPremium + alias). Returns false if it has not arrived
 * within the timeout; the purchase itself is not affected.
 */
async function waitForPremiumAccount(timeoutMs = 30000): Promise<boolean> {
  const started = Date.now();
  while (Date.now() - started < timeoutMs) {
    try {
      await monetization.syncFromServer(true);
      await monetization.loadAccount();
      if (monetization.isPremium && monetization.userAlias) return true;
    } catch {
      // retry until the timeout
    }
    await new Promise((r) => setTimeout(r, 1500));
  }
  return false;
}

async function showAliasAfterPurchase(): Promise<void> {
  // The account (and this device's link to it) is created by the purchase
  // webhook, so it does not exist yet on the first attempts. Poll the account
  // — not just the profile — until the alias lands, then stop.
  for (let attempt = 0; attempt < 6; attempt++) {
    try {
      await monetization.loadAccount();
      if (monetization.userAlias) return;
    } catch {
      // ignore
    }
    await new Promise((r) => setTimeout(r, 500));
  }
}

async function handleStaticPurchase(alias?: string, password?: string) {
  debugStore.info('Paywall.vue: handleStaticPurchase called');
  if (isPurchasing.value) return;
  isPurchasing.value = true;
  errorMessage.value = null;

  try {
    debugStore.info('Paywall.vue: calling monetization.purchase (static)');
    const result = await monetization.purchase(undefined, alias, password);
    debugStore.info('Paywall.vue: monetization.purchase result', {
      success: result.success,
      error: result.error,
    });
    if (!result.success && result.error) {
      errorMessage.value = result.error;
    }
  } catch (e) {
    const catchError = e instanceof Error ? e.message : String(e);
    errorMessage.value = `Unexpected error: ${catchError}`;
    console.error('handleStaticPurchase exception:', e);
  } finally {
    isPurchasing.value = false;
  }
}

/**
 * Web / Electron purchase via the RevenueCat Web SDK (Paddle Billing).
 * The checkout renders inline into the paywall's container element; the
 * revenuecat-webhook creates the canonical `accounts` row from subscriber
 * attributes. The RC appUserID is the device Supabase uid until Phase 4.
 */
async function handleWebPurchase(alias: string, password: string) {
  if (isPurchasing.value) return;
  isPurchasing.value = true;
  errorMessage.value = null;
  ctaMessage.value = null;
  ctaIsError.value = false;

  try {
    // Pre-flight: verify the RC Web Billing public key is configured before
    // attempting any network calls. Without it, configure() throws and the
    // downstream setAttributes silently returns false — surfacing the cause
    // here saves hours of debugging a "Could not save your credentials" loop.
    const configured = await RevenueCatService.isWebConfigured();
    if (!configured) {
      ctaMessage.value =
        'Web Paddle API key not configured. Set VITE_RC_PADDLE_SERVER_SANDBOX_API_KEY ' +
        '(sandbox/dev) or VITE_RC_PADDLE_SERVER_API_KEY (production) in packages/app/.env.local.';
      ctaIsError.value = true;
      return;
    }

    if (!monetization.isInitialized) {
      await monetization.init();
    }

    // Initialize RC Web SDK with the device Supabase uid (until Phase 4).
    // Set attributes BEFORE purchase so the webhook receives them.
    await RevenueCatService.initWeb(monetization.userId ?? '');

    // The web SDK does not cache or retry attributes on failure — if this
    // fails, alias/password never reach the webhook and the account is not
    // created, so retry before purchase().
    let attrsOk = await RevenueCatService.setAttributes({
      skm_alias: alias,
      skm_secret: password,
      user_id: monetization.userId ?? '',
    });
    let attempts = 0;
    while (!attrsOk && attempts < 2) {
      await new Promise((r) => setTimeout(r, 400));
      attrsOk = await RevenueCatService.setAttributes({
        skm_alias: alias,
        skm_secret: password,
        user_id: monetization.userId ?? '',
      });
      attempts++;
    }
    if (!attrsOk) {
      ctaMessage.value = 'Could not save your credentials. Please try again.';
      ctaIsError.value = true;
      return;
    }

    // Load web offerings and pick the lifetime package.
    const webOfferings = await RevenueCatService.getOfferingsWeb();
    const webPackages =
      webOfferings?.current?.availablePackages ??
      Object.values(webOfferings?.all ?? {}).flatMap((o: any) => o?.availablePackages ?? []);
    if (!webPackages || webPackages.length === 0) {
      ctaMessage.value =
        'No purchase options available. Check RC dashboard → Web → Billing → Offerings.';
      ctaIsError.value = true;
      return;
    }
    const lifetime =
      webPackages.find((p: any) => p?.packageType === '$rc_lifetime') ?? webPackages[0];

    const checkoutContainer = document.getElementById('rc-web-checkout-container');
    const result = await RevenueCatService.purchasePackageWeb(
      lifetime,
      checkoutContainer ?? undefined
    );

    if (!result.success) {
      if (result.cancelled) {
        ctaMessage.value = 'Purchase cancelled.';
      } else {
        ctaMessage.value = result.error ?? 'Store returned no error, but success was false.';
      }
      ctaIsError.value = true;
      return;
    }

    // Immediate unlock based on the entitlement in the returned customerInfo.
    monetization.isPremium = true;
    await new Promise((r) => setTimeout(r, 1500));
    await monetization.syncFromServer(true);
    await showAliasAfterPurchase();
    const notice = accountNoticeAfterPurchase(
      alias.trim().toUpperCase(),
      password.trim().toUpperCase()
    );
    if (notice) {
      aliasRaceMessage.value = notice;
      await new Promise((r) => setTimeout(r, 7000));
    }
    emit('purchased');
    debugStore.info('Paywall.vue: emit close', {
      source: 'handleWebPurchase',
      stack: new Error().stack?.split('\n').slice(1, 4).join(' > '),
    });
    emit('close');
  } catch (e) {
    const catchError = e instanceof Error ? e.message : String(e);
    ctaMessage.value = `Unexpected error: ${catchError}`;
    ctaIsError.value = true;
    console.error('handleWebPurchase exception:', e);
  } finally {
    isPurchasing.value = false;
  }
}

/**
 * The CTA doubles as "close" for a player who is already premium: there is
 * nothing left to unlock, and the purchase path cannot run (its inputs are only
 * rendered for free users).
 */
async function handleCtaClick(): Promise<void> {
  if (monetization.isPremium) {
    debugStore.info('Paywall.vue: emit close', {
      source: 'handleCtaClick',
      stack: new Error().stack?.split('\n').slice(1, 4).join(' > '),
    });
    emit('close');
    return;
  }
  await handlePrimaryAction();
}

/** The restore form's button and Enter key: password restore or recovery-word restore. */
function submitRestoreForm(): Promise<void> {
  return restoreLostPassword.value ? handleRecoverWithWord() : handleRestoreAlias();
}

/**
 * Maps server validation error codes to user-friendly messages.
 */
function getServerErrorMessage(field: string, error: string | undefined): string {
  const messages: Record<string, Record<string, string>> = {
    alias: {
      alias_required: 'Your alias must be 8–16 characters.',
      alias_too_short: 'Your alias must be at least 8 characters.',
      alias_too_long: 'Your alias must be 16 characters or fewer.',
      alias_invalid_chars: 'Only uppercase A–Z and digits 0–9 (no spaces or symbols).',
      alias_taken: 'That alias is already taken — pick another one.',
    },
    password: {
      password_required: 'Your password must be 8–16 characters.',
      password_too_short: 'Your password must be at least 8 characters.',
      password_too_long: 'Your password must be 16 characters or fewer.',
      password_invalid_chars: 'Only uppercase A–Z and digits 0–9 (no spaces or symbols).',
      password_equals_alias: 'Password cannot be the same as your alias.',
    },
    word: {
      word_required: 'Recovery word must be 4–16 characters.',
      word_too_short: 'Recovery word must be at least 4 characters.',
      word_too_long: 'Recovery word must be 16 characters or fewer.',
      word_invalid_format: 'Recovery word must be uppercase letters and numbers only (no spaces).',
      word_equals_alias: 'Recovery word cannot be the same as your alias.',
      word_equals_password: 'Recovery word cannot be the same as your password.',
    },
    confirm: {
      password_equals_alias: 'Password cannot be the same as your alias.',
      word_equals_password: 'Confirmation must match your password.',
    },
  };

  return (error && messages[field]?.[error]) || `Invalid ${field}. Please check and try again.`;
}

async function handlePrimaryAction() {
  console.log('CTA Button Clicked');

  // Local validation first
  const alias = buyAliasInput.value.trim().toUpperCase();
  const password = buyPasswordInput.value.trim().toUpperCase();
  const confirm = buyConfirmPassword.value.trim().toUpperCase();

  const aliasResult = validateAlias(alias);
  if (!aliasResult.valid) {
    ctaMessage.value = getServerErrorMessage('alias', aliasResult.error);
    ctaIsError.value = true;
    validation.value.alias = { valid: false, error: aliasResult.error };
    validation.value.aliasAvailable = false;
    return;
  }

  const pwdResult = validatePassword(password);
  if (!pwdResult.valid) {
    ctaMessage.value = getServerErrorMessage('password', pwdResult.error);
    ctaIsError.value = true;
    validation.value.password = { valid: false, error: pwdResult.error };
    return;
  }

  const confResult = validateConfirm(password, confirm);
  if (!confResult.valid) {
    ctaMessage.value = getServerErrorMessage('confirm', confResult.error);
    ctaIsError.value = true;
    validation.value.confirm = { valid: false, error: confResult.error };
    return;
  }

  // Cross-field checks
  const crossAliasPwd = validateAliasVsPassword(alias, password);
  if (!crossAliasPwd.valid) {
    ctaMessage.value = getServerErrorMessage('password', crossAliasPwd.error);
    ctaIsError.value = true;
    validation.value.password = { valid: false, error: crossAliasPwd.error };
    return;
  }

  // Alias availability via RPC
  try {
    const { data, error } = await supabase.rpc('check_alias_availability', { candidate: alias });
    if (error) {
      console.warn('Alias availability check failed:', error.message);
      // Don't block on RPC error — webhook handles collisions
    } else if (data?.[0]?.is_available === false) {
      ctaMessage.value = getServerErrorMessage('alias', 'alias_taken');
      ctaIsError.value = true;
      validation.value.alias = { valid: false, error: 'alias_taken' };
      validation.value.aliasAvailable = false;
      return;
    }
  } catch (err) {
    console.warn('Alias availability check error:', err);
    // Don't block on network error
  }

  // All validation passed
  validation.value.alias = { valid: true };
  validation.value.aliasAvailable = true;
  validation.value.password = { valid: true };
  validation.value.confirm = { valid: true };

  if (!isCredentialsRememberedConfirmed.value) {
    showDisclaimerModal.value = true;
    return;
  }

  ctaMessage.value = null;
  ctaIsError.value = false;
  ctaIsSuccess.value = false;

  if (isNativeMobile.value) {
    if (!selectedPackage.value) {
      await loadOfferings();
      if (!selectedPackage.value) {
        ctaMessage.value = 'Could not load product. Tap "Retry loading offers" or restart the app.';
        ctaIsError.value = true;
        return;
      }
    }

    await handlePurchase(selectedPackage.value);
  } else {
    await handleWebPurchase(alias, password);
  }
}

async function checkAgain(): Promise<void> {
  showCheckAgain.value = false;
  ctaMessage.value = null;
  ctaIsError.value = false;
  ctaIsSuccess.value = false;
  isSyncingAccount.value = true;
  try {
    const accountReady = await waitForPremiumAccount(15000);
    if (accountReady) {
      emit('purchased');
      debugStore.info('Paywall.vue: emit close', {
        source: 'checkAgain',
        stack: new Error().stack?.split('\n').slice(1, 4).join(' > '),
      });
      emit('close');
    } else {
      ctaMessage.value = 'Purchase confirmed with the store. Finishing setup…';
      ctaIsSuccess.value = true;
      showCheckAgain.value = true;
    }
  } finally {
    isSyncingAccount.value = false;
  }
}

async function confirmCredentials() {
  isCredentialsRememberedConfirmed.value = true;
  showDisclaimerModal.value = false;
  // 'Roger' = the user has noted the alias/password, so start the payment now.
  // The CTA button shows "Processing..." (isPurchasing) until the purchase
  // and the account creation by the webhook have finished.
  await handlePrimaryAction();
}

function closeDisclaimer() {
  showDisclaimerModal.value = false;
}

/**
 * The prominent "Already purchased? Restore" button scrolls the alias/password
 * restore form into view rather than triggering a restore on its own. A player
 * who already paid on another platform needs to enter credentials, not get a
 * silent RC restore that may or may not match this device's anonymous id.
 */
function scrollRestoreIntoView(): void {
  debugStore.info('Paywall.vue: scrollRestoreIntoView called');
  const el = document.getElementById('restore-section');
  if (el) {
    el.scrollIntoView({ behavior: 'smooth', block: 'start' });
    return;
  }
  // Fallback: run the automatic restore if the form is not in the DOM (e.g.
  // the panel scrolled out of view on a short screen).
  if (!isBusy.value) {
    debugStore.info('Paywall.vue: scrollRestoreIntoView fallback - calling handleRestore');
    void runAction('auto-restore', handleRestore);
  }
}

async function handleRestore() {
  if (isPurchasing.value) return;
  isPurchasing.value = true;
  errorMessage.value = null;

  try {
    if (isNativeMobile.value) {
      // Native: ask the RevenueCat SDK to restore, then VERIFY with server.
      const customerInfo = await purchasesRestore();
      const hasRCEntitlement = customerInfo?.entitlements?.active?.['pro_access'];
      if (hasRCEntitlement) {
        // RC says there's a purchase — now sync with Supabase to confirm account exists
        isSyncingAccount.value = true;
        try {
          await monetization.syncFromServer(true);
          if (monetization.isPremium && monetization.userAlias) {
            await showAliasAfterPurchase();
            emit('purchased');
            debugStore.info('Paywall.vue: emit close', {
              source: 'handleRestore (native entitlement verified)',
              stack: new Error().stack?.split('\n').slice(1, 4).join(' > '),
            });
            emit('close');
            return;
          }
          // The purchase may already have an account this device is not linked to (after
          // "Switch to another account", or a webhook that never linked it). claim-purchase
          // checks the entitlement server-side and links that account. With no alias and
          // password it never creates one (`invalid_credentials`, nothing written), so a
          // TRANSFER webhook still running after a reinstall is left to the wait below.
          const claim = await monetization.claimPurchase('', '');
          if (claim.success) {
            emit('purchased');
            debugStore.info('Paywall.vue: emit close', {
              source: 'handleRestore (native purchase claimed)',
              stack: new Error().stack?.split('\n').slice(1, 4).join(' > '),
            });
            emit('close');
            return;
          }
          // RC has entitlement but server doesn't have account yet — wait for it
          const accountReady = await waitForPremiumAccount(30000);
          if (accountReady) {
            emit('purchased');
            debugStore.info('Paywall.vue: emit close', {
              source: 'handleRestore (native account wait succeeded)',
              stack: new Error().stack?.split('\n').slice(1, 4).join(' > '),
            });
            emit('close');
            return;
          }
          // The store has the purchase but no account was ever created for it. Waiting
          // will not change that: tapping Unlock hits "already active" and claims it.
          ctaMessage.value =
            'We found your purchase but no account is linked to it yet. Choose an alias and password above, then tap Unlock Full Access to link it.';
          ctaIsError.value = false;
          return;
        } finally {
          isSyncingAccount.value = false;
        }
      }
    } else {
      // Web / Electron: re-bind to the stable identity and ask the Web SDK to
      // restore. The RC appUserID must be the PRIVATE password, never the
      // public alias — the alias appears on the leaderboard, so binding RC to
      // the alias would let anyone reading the leaderboard steal premium access.
      const stableId = monetization.userPassword || monetization.userId;
      if (stableId) {
        const restored = await RevenueCatService.logIn(stableId);
        if (restored) {
          // RC says there's a purchase — now sync with Supabase to confirm account exists
          isSyncingAccount.value = true;
          try {
            await monetization.syncFromServer(true);
            if (monetization.isPremium && monetization.userAlias) {
              await showAliasAfterPurchase();
              emit('purchased');
              debugStore.info('Paywall.vue: emit close', {
                source: 'handleRestore (web identity restored)',
                stack: new Error().stack?.split('\n').slice(1, 4).join(' > '),
              });
              emit('close');
              return;
            }
            // RC has entitlement but server doesn't have account yet — wait for it
            const accountReady = await waitForPremiumAccount(30000);
            if (accountReady) {
              emit('purchased');
              debugStore.info('Paywall.vue: emit close', {
                source: 'handleRestore (web account wait succeeded)',
                stack: new Error().stack?.split('\n').slice(1, 4).join(' > '),
              });
              emit('close');
              return;
            }
            ctaMessage.value =
              'Payment received. Your account is still being set up. Wait a moment, then tap Restore or reopen the app.';
            ctaIsError.value = true;
            return;
          } finally {
            isSyncingAccount.value = false;
          }
        }
      }
      await RevenueCatService.restorePurchasesWeb().catch(() => null);
    }

    // Fall through to a server sync — the webhook may have already marked the
    // device premium even if the SDK restore did not surface it.
    await monetization.syncFromServer(true);
    if (monetization.isPremium && monetization.userAlias) {
      await showAliasAfterPurchase();
      emit('purchased');
      debugStore.info('Paywall.vue: emit close', {
        source: 'handleRestore (post-restore server sync)',
        stack: new Error().stack?.split('\n').slice(1, 4).join(' > '),
      });
      emit('close');
    } else {
      errorMessage.value = 'No previous purchase found.';
    }
  } catch (e) {
    errorMessage.value = e instanceof Error ? e.message : String(e);
  } finally {
    isPurchasing.value = false;
  }
}

async function handleRestoreAlias() {
  const alias = restoreAliasInput.value.trim().toUpperCase();
  const password = restorePasswordInput.value.trim().toUpperCase();
  if (!alias || !password || isPurchasing.value) return;

  // Local validation first
  const aliasResult = validateAlias(alias);
  if (!aliasResult.valid) {
    restoreAliasError.value = getServerErrorMessage('alias', aliasResult.error);
    return;
  }

  const pwdResult = validatePassword(password);
  if (!pwdResult.valid) {
    restoreAliasError.value = getServerErrorMessage('password', pwdResult.error);
    return;
  }

  const crossResult = validateAliasVsPassword(alias, password);
  if (!crossResult.valid) {
    restoreAliasError.value = getServerErrorMessage('password', crossResult.error);
    return;
  }

  isPurchasing.value = true;
  isRestoringAlias.value = true;
  restoreAliasError.value = null;
  restoreAliasSuccess.value = false;

  try {
    const result = await monetization.restoreAccount(alias, password);
    if (result.success) {
      restoreAliasSuccess.value = true;
      // Awaited, not a timer: the paywall stays busy until it closes.
      await new Promise((r) => setTimeout(r, 700));
      emit('purchased');
      debugStore.info('Paywall.vue: emit close', {
        source: 'handleRestoreAlias',
        stack: new Error().stack?.split('\n').slice(1, 4).join(' > '),
      });
      emit('close');
    } else if (result.error === 'not_found') {
      monetization.logoutLocally('restore account not found');
      restoreAliasError.value = 'No user found, check your spelling';
    } else if (result.error === 'not_paid') {
      restoreAliasError.value = 'This alias is not associated with a paid account';
    } else if (result.error === 'already_linked') {
      restoreAliasError.value = 'This device is already linked to a different account';
    } else if (result.error === 'rate_limited') {
      restoreAliasError.value = tooManyAttemptsMessage(result.retryAfterSeconds);
    } else if (result.error === 'invalid') {
      restoreAliasError.value = 'Check the alias and password, then try again';
    } else if (result.error === 'network') {
      restoreAliasError.value = 'Network error — please check your connection and try again';
    } else {
      restoreAliasError.value = 'Unknown error, try again';
    }
  } catch (e) {
    restoreAliasError.value = e instanceof Error ? e.message : String(e);
  } finally {
    isPurchasing.value = false;
    isRestoringAlias.value = false;
  }
}

/**
 * The "I lost my password" path. A player who has lost every device has no
 * linked profile, so this screen is the only place they can possibly reach —
 * which is why the toggle lives here and not on the Premium screen.
 *
 * On success the store has already run the full restore (device linked,
 * RevenueCat re-bound, scores reloaded), so this just confirms and closes on
 * the same 700ms beat as the alias+password restore.
 *
 * On failure `logoutLocally()` is deliberately NOT called, unlike
 * `handleRestoreAlias` above: this device was free to begin with, so there is
 * no premium state to protect and nothing to clear.
 */
function clearLocalData(): void {
  debugStore.info('Paywall.vue: clearLocalData called');
  console.log('🗑️ Paywall.vue: User cleared local data from paywall');
  monetization.logoutLocally('user cleared local data');
  debugStore.info('Paywall.vue: emit close', {
    source: 'clearLocalData',
    stack: new Error().stack?.split('\n').slice(1, 4).join(' > '),
  });
  emit('close');
}

async function handleRecoverWithWord() {
  const alias = restoreAliasInput.value.trim().toUpperCase();
  const word = restorePasswordInput.value.trim().toUpperCase();
  if (!alias || !word || isPurchasing.value) return;

  // Local validation first
  const aliasResult = validateAlias(alias);
  if (!aliasResult.valid) {
    restoreAliasError.value = getServerErrorMessage('alias', aliasResult.error);
    return;
  }

  const wordResult = validateWord(word);
  if (!wordResult.valid) {
    restoreAliasError.value = getServerErrorMessage('word', wordResult.error);
    return;
  }

  const crossAliasWord = validateWordVsAlias(word, alias);
  if (!crossAliasWord.valid) {
    restoreAliasError.value = getServerErrorMessage('word', crossAliasWord.error);
    return;
  }

  isPurchasing.value = true;
  isRestoringAlias.value = true;
  restoreAliasError.value = null;
  restoreAliasSuccess.value = false;

  try {
    const result = await monetization.recoverWithWord(alias, word);
    if (result.success) {
      restoreAliasSuccess.value = true;
      // Awaited, not a timer: the paywall stays busy until it closes.
      await new Promise((r) => setTimeout(r, 700));
      emit('purchased');
      debugStore.info('Paywall.vue: emit close', {
        source: 'handleRecoverWithWord',
        stack: new Error().stack?.split('\n').slice(1, 4).join(' > '),
      });
      emit('close');
    } else if (result.error === 'no_recovery_word') {
      restoreAliasError.value = 'No recovery word was ever set for this account';
    } else if (result.error === 'not_paid') {
      restoreAliasError.value = 'This alias is not associated with a paid account';
    } else if (result.error === 'already_linked') {
      restoreAliasError.value = 'This device is already linked to a different account';
    } else if (result.error === 'rate_limited') {
      restoreAliasError.value = tooManyAttemptsMessage(result.retryAfterSeconds);
    } else if (result.error === 'invalid') {
      restoreAliasError.value = 'Check the alias and word, then try again';
    } else {
      restoreAliasError.value = 'No account found with that alias and word';
    }
  } catch (e) {
    restoreAliasError.value = e instanceof Error ? e.message : String(e);
  } finally {
    isPurchasing.value = false;
    isRestoringAlias.value = false;
  }
}

function toggleLostPassword() {
  restoreLostPassword.value = !restoreLostPassword.value;
  restoreAliasError.value = null;
  restoreAliasSuccess.value = false;
}

async function copyRecoveryWord(): Promise<void> {
  const word = monetization.recoveryWord;
  if (!word) return;
  try {
    await navigator.clipboard.writeText(word);
    recoveryWordCopied.value = true;
    setTimeout(() => (recoveryWordCopied.value = false), 1500);
  } catch {
    recoveryWordCopied.value = true;
    setTimeout(() => (recoveryWordCopied.value = false), 1500);
  }
}

function continueFreePlay(): void {
  monetization.logoutLocally('user declined restore');
  debugStore.info('Paywall.vue: emit close', {
    source: 'continueFreePlay',
    stack: new Error().stack?.split('\n').slice(1, 4).join(' > '),
  });
  emit('close');
}

/**
 * The bottom button means two different things by tier, so it must not share
 * one handler: logging a premium player out locally is not "delete account" —
 * it clears the only copy of their alias/password on this device and can lock
 * them out of a paid account they own.
 */
function handleLastAction(): void {
  debugStore.info('Paywall.vue: handleLastAction called', { isPremium: monetization.isPremium });
  if (!monetization.isPremium) {
    debugStore.info('Paywall.vue: handleLastAction - continueFreePlay');
    continueFreePlay();
    return;
  }
  debugStore.info(
    'Paywall.vue: handleLastAction - premium user, emit close and navigate to Settings'
  );
  debugStore.info('Paywall.vue: emit close', {
    source: 'handleLastAction (premium)',
    stack: new Error().stack?.split('\n').slice(1, 4).join(' > '),
  });
  emit('close');
  void router.push({ name: 'Settings' });
}

/**
 * Unlinks this device from its current account (if any) and scrolls to the
 * restore form so the player can enter another account's alias + password.
 * For free users this is a no-op unlink but still scrolls to the form.
 */
async function startSwitchAccount(): Promise<void> {
  if (isSwitchingAccount.value) return;
  debugStore.info('Paywall.vue: start switch account');
  errorMessage.value = null;
  isSwitchingAccount.value = true;
  const result = await monetization.unlinkDevice().finally(() => {
    isSwitchingAccount.value = false;
  });
  if (!result.success) {
    errorMessage.value = 'Could not switch account. Check your connection and try again.';
    return;
  }
  if (result.wasLinked) {
    restoreAliasInput.value = '';
    restorePasswordInput.value = '';
    restoreLostPassword.value = false;
    restoreAliasError.value = null;
  }
  // Always scroll to the restore form so all users can enter credentials
  const el = document.getElementById('restore-section');
  el?.scrollIntoView({ behavior: 'smooth', block: 'start' });
}

/**
 * Unlinks this device and clears all local premium state, then closes the
 * paywall. The player keeps free play; the purchase stays on the original
 * account and can be restored later with alias + password.
 */
async function startFresh(): Promise<void> {
  debugStore.info('Paywall.vue: start fresh');
  errorMessage.value = null;
  const result = await monetization.unlinkDevice();
  if (!result.success) {
    // Do NOT wipe local state when the server still has this device linked: the next
    // launch would silently restore premium and "start fresh" would not have happened.
    errorMessage.value = 'Could not start fresh. Check your connection and try again.';
    return;
  }
  debugStore.info('Paywall.vue: emit close', {
    source: 'startFresh',
    stack: new Error().stack?.split('\n').slice(1, 4).join(' > '),
  });
  emit('close');
}

// ── Pre-purchase alias probe (debounced 400ms) ──────────────────────────────────
function onBuyAliasInput(): void {
  const raw = buyAliasInput.value.toUpperCase();
  buyAliasInput.value = raw;

  // Clear previous validation
  validation.value.alias = undefined;
  validation.value.aliasAvailable = undefined;

  // Local format check first
  const formatResult = validateAlias(raw);
  if (!formatResult.valid) {
    validation.value.alias = { valid: false, error: formatResult.error };
    validation.value.checking = false;
    return;
  }

  if (raw.length < 8) {
    validation.value.checking = false;
    return;
  }

  // Debounce alias availability RPC
  if (buyAliasProbeTimer) {
    clearTimeout(buyAliasProbeTimer);
    buyAliasProbeTimer = null;
  }

  validation.value.checking = true;

  buyAliasProbeTimer = setTimeout(async () => {
    try {
      const { data, error } = await supabase.rpc('check_alias_availability', { candidate: raw });
      validation.value.checking = false;
      if (error) {
        // Treat RPC error as "unknown" — don't block the user (webhook handles collisions)
        console.warn('Alias availability check failed:', error.message);
        validation.value.alias = { valid: true };
        validation.value.aliasAvailable = true;
      } else if (data?.[0]?.is_available === false) {
        validation.value.alias = { valid: false, error: 'alias_taken' };
        validation.value.aliasAvailable = false;
      } else {
        validation.value.alias = { valid: true };
        validation.value.aliasAvailable = true;
      }
    } catch (err) {
      console.warn('Alias availability check error:', err);
      validation.value.checking = false;
      // On network error, don't block — webhook will handle
      validation.value.alias = { valid: true };
      validation.value.aliasAvailable = true;
    }
  }, 400);
}

// ── Clipboard helpers ─────────────────────────────────────────────────────────
async function copyAlias(): Promise<void> {
  const alias = monetization.userAlias;
  if (!alias) return;
  try {
    await navigator.clipboard.writeText(alias);
    aliasCopied.value = true;
    setTimeout(() => (aliasCopied.value = false), 1500);
  } catch {
    aliasCopied.value = true;
    setTimeout(() => (aliasCopied.value = false), 1500);
  }
}

async function copyPassword(): Promise<void> {
  const password = monetization.userPassword;
  if (!password) return;
  try {
    await navigator.clipboard.writeText(password);
    passwordCopied.value = true;
    setTimeout(() => (passwordCopied.value = false), 1500);
  } catch {
    passwordCopied.value = true;
    setTimeout(() => (passwordCopied.value = false), 1500);
  }
}

async function copyBoth(): Promise<void> {
  const alias = monetization.userAlias;
  const password = monetization.userPassword;
  if (!alias || !password) return;
  const text = `${alias}\n${password}`;
  try {
    await navigator.clipboard.writeText(text);
    copyBothLabel.value = 'Copied!';
    setTimeout(() => (copyBothLabel.value = 'Copy both — alias + password'), 1500);
  } catch {
    copyBothLabel.value = 'Copy failed — retype below';
    setTimeout(() => (copyBothLabel.value = 'Copy both — alias + password'), 2000);
  }
}
</script>

<style scoped>
.paywall-overlay {
  position: fixed;
  inset: 0;
  z-index: 9999;
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 16px;
  background: rgba(4, 13, 20, 0.82);
  backdrop-filter: blur(8px);
}

.paywall-panel {
  position: relative;
  width: 100%;
  max-width: 440px;
  max-height: 92vh;
  overflow-y: auto;
  background: #071520;
  border: 1px solid rgba(0, 191, 255, 0.22);
  border-radius: 20px;
  padding: 40px 32px 28px;
  box-shadow: 0 0 0 1px rgba(0, 191, 255, 0.06), 0 30px 80px rgba(0, 0, 0, 0.7);
}

.debug-badge {
  position: absolute;
  top: 12px;
  left: 12px;
  background: rgba(255, 220, 0, 0.9);
  color: #000;
  font-size: 10px;
  padding: 3px 8px;
  border-radius: 4px;
  cursor: pointer;
  z-index: 10;
  font-weight: bold;
}

.debug-panel {
  background: rgba(0, 30, 0, 0.95);
  color: #0f0;
  font-family: monospace;
  padding: 12px;
  border-radius: 8px;
  margin: 12px 0;
  font-size: 11px;
  line-height: 1.6;
  border: 1px solid #0f0;
  word-break: break-all;
}

.close-btn {
  position: absolute;
  top: 16px;
  right: 16px;
  width: 32px;
  height: 32px;
  display: flex;
  align-items: center;
  justify-content: center;
  background: rgba(0, 191, 255, 0.08);
  border: 1px solid rgba(0, 191, 255, 0.2);
  border-radius: 50%;
  color: #5d8499;
  cursor: pointer;
}

.panel-header {
  margin-bottom: 24px;
}
.panel-header .headline {
  font-size: 36px;
  line-height: 1.1;
  margin: 8px 0 12px;
  color: #fff;
}
.panel-header .subhead {
  color: #5d8499;
  font-size: 14px;
}

.badge {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  background: rgba(0, 191, 255, 0.1);
  border: 1px solid rgba(0, 191, 255, 0.3);
  border-radius: 20px;
  padding: 4px 12px;
  font-size: 11px;
  font-weight: 700;
  color: #00bfff;
  letter-spacing: 0.08em;
}

.badge-dot {
  width: 6px;
  height: 6px;
  border-radius: 50%;
  background: #00bfff;
}

.packages-loading {
  text-align: center;
  color: #5d8499;
  padding: 20px 0;
  font-size: 14px;
}
.packages {
  margin-bottom: 8px;
}

.package-card {
  width: 100%;
  background: rgba(255, 255, 255, 0.04);
  border: 1px solid rgba(0, 191, 255, 0.15);
  border-radius: 12px;
  padding: 14px 16px;
  margin-bottom: 8px;
  text-align: left;
  cursor: pointer;
  transition: border-color 0.2s;
  color: #fff;
}

.package-card:hover,
.package-card.selected {
  border-color: rgba(0, 191, 255, 0.5);
  background: rgba(0, 191, 255, 0.06);
}

.package-card.featured {
  border-color: rgba(0, 191, 255, 0.35);
}
.package-card--static {
  pointer-events: none;
  cursor: default;
}
.package-badge {
  font-size: 10px;
  font-weight: 700;
  color: #00bfff;
  letter-spacing: 0.08em;
  margin-bottom: 4px;
}
.package-name {
  font-weight: 600;
  font-size: 15px;
}
.package-price {
  font-size: 20px;
  font-weight: 700;
  color: #00bfff;
  margin: 2px 0;
}
.package-desc {
  font-size: 12px;
  color: #5d8499;
}

.cta-btn {
  width: 100%;
  height: 52px;
  background: linear-gradient(135deg, #00bfff 0%, #0099cc 100%);
  border: none;
  border-radius: 12px;
  color: #040d14;
  font-weight: 700;
  margin: 16px 0 8px;
  cursor: pointer;
  font-size: 16px;
  transition: opacity 0.2s;
}

.cta-btn:disabled {
  opacity: 0.5;
  cursor: not-allowed;
}

.restore-btn {
  width: 100%;
  color: #3a6070;
  background: transparent;
  border: none;
  font-size: 13px;
  cursor: pointer;
  padding: 8px;
}

.restore-btn.subtle {
  font-size: 12px;
  color: #5d8499;
  padding: 4px 8px;
  margin-top: 4px;
}

.restore-btn.subtle:hover {
  color: #7aa0b5;
  background: rgba(255, 255, 255, 0.03);
  border-radius: 6px;
}

/* Prominent "Already purchased? Restore" entry point, placed at the TOP of the
   free-mode paywall above the credential capture. A player who already paid on
   another platform must see this before the purchase form, or they fill in
   credentials and pay twice. Styled as a real button (full width, bordered,
   accent color) rather than a link buried at the bottom. */
.restore-prominent {
  margin: 4px 0 18px;
}
.restore-prominent-btn {
  width: 100%;
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 10px;
  padding: 14px 16px;
  background: rgba(0, 191, 255, 0.08);
  border: 1px solid rgba(0, 191, 255, 0.45);
  border-radius: 12px;
  color: #00bfff;
  font-size: 15px;
  font-weight: 700;
  cursor: pointer;
  transition: background 0.2s, border-color 0.2s;
}
.restore-prominent-btn:hover {
  background: rgba(0, 191, 255, 0.16);
  border-color: rgba(0, 191, 255, 0.7);
}
.restore-prominent-icon {
  font-size: 18px;
}
.restore-prominent-text strong {
  font-weight: 700;
}
.restore-prominent-sub {
  margin: 8px 0 0;
  font-size: 12px;
  color: #5d8499;
  line-height: 1.4;
  text-align: center;
}

.cta-message {
  font-size: 13px;
  text-align: center;
  margin: 8px 0;
  min-height: 20px;
  color: #7aa0b5;
}

.cta-message--error {
  color: #ff8099;
}

.cta-message--success {
  color: #6fe0a0;
}

.check-again-btn {
  width: 100%;
  height: 44px;
  background: transparent;
  border: 1px solid rgba(0, 191, 255, 0.3);
  border-radius: 10px;
  color: #00bfff;
  font-weight: 700;
  font-size: 13px;
  cursor: pointer;
  margin-top: 8px;
  transition: all 0.2s;
}

.check-again-btn:hover {
  background: rgba(0, 191, 255, 0.1);
  border-color: rgba(0, 191, 255, 0.5);
}

.check-again-btn:disabled {
  opacity: 0.4;
  cursor: not-allowed;
}

.restore-btn:disabled {
  opacity: 0.5;
}

.retry-btn {
  width: 100%;
  color: #00bfff;
  background: transparent;
  border: 1px solid rgba(0, 191, 255, 0.3);
  border-radius: 8px;
  font-size: 13px;
  cursor: pointer;
  padding: 8px;
  margin-top: 8px;
}

.error-banner {
  background: rgba(255, 77, 109, 0.15);
  border: 1px solid rgba(255, 77, 109, 0.4);
  color: #ff8099;
  padding: 12px;
  border-radius: 8px;
  margin: 12px 0;
  font-size: 13px;
}

/* ── Legal links (web build only) ─────────────────────────────────────────── */
.legal-links {
  display: flex;
  flex-wrap: wrap;
  justify-content: center;
  align-items: center;
  gap: 8px 18px;
  margin-top: 22px;
  padding-top: 16px;
  border-top: 1px solid rgba(255, 255, 255, 0.08);
}

.legal-link {
  font-size: 11.5px;
  line-height: 1.4;
  color: #7aa0b5;
  text-decoration: none;
  cursor: pointer;
  transition: color 0.2s;
  /* Comfortable tap target on a phone-sized browser viewport. */
  padding: 4px 2px;
}

.legal-link:hover {
  color: #00bfff;
  text-decoration: underline;
}

.legal-link:active {
  color: #0099cc;
}

.key-display {
  background: rgba(0, 191, 255, 0.06);
  border: 1px solid rgba(0, 191, 255, 0.25);
  border-radius: 12px;
  padding: 14px 16px;
  margin: 16px 0 8px;
  text-align: center;
  cursor: pointer;
}

.key-display-label {
  font-size: 10px;
  font-weight: 700;
  letter-spacing: 0.12em;
  color: #00bfff;
  margin-bottom: 6px;
}

.key-display-value {
  font-size: 22px;
  font-weight: 700;
  letter-spacing: 0.22em;
  color: #fff;
  position: relative;
}

.key-display-pass-box {
  display: flex;
  align-items: center;
  justify-content: space-between;
}

/* Masked password: fewer glyphs than a 8-16 char password, so the block keeps
   its height and the copy hint below does not jump. */
.key-display-mask {
  color: #9fc;
  opacity: 0.75;
}

.key-display-eye {
  position: absolute;
  right: 0;
  top: 0;
  background: transparent;
  border: 1px solid rgba(255, 255, 255, 0.15);
  border-radius: 8px;
  color: #9fc;
  width: 32px;
  height: 32px;
  display: flex;
  align-items: center;
  justify-content: center;
  font-size: 16px;
  cursor: pointer;
  transition: color 0.15s, border-color 0.15s;
}

.key-display-eye:hover {
  color: #00bfff;
  border-color: rgba(0, 191, 255, 0.5);
}

.key-display-copy {
  display: block;
  font-size: 11px;
  font-weight: 400;
  color: #00bfff;
  margin-top: 4px;
}

.key-display-note {
  font-size: 11px;
  color: #7aa0b5;
  line-height: 1.45;
  margin: 8px 0 0;
}

.credentials-capture {
  margin: 18px 0 8px;
  padding-top: 16px;
  border-top: 1px solid rgba(255, 255, 255, 0.08);
}

.credentials-clear {
  margin-top: 12px;
  text-align: center;
}

.clear-local-btn {
  height: 40px;
  padding: 0 16px;
  background: transparent;
  border: 1px solid rgba(255, 80, 80, 0.4);
  border-radius: 8px;
  color: #ff8099;
  font-size: 12px;
  font-weight: 600;
  cursor: pointer;
  transition: all 0.2s;
}

.clear-local-btn:hover {
  background: rgba(255, 80, 80, 0.15);
  border-color: rgba(255, 80, 80, 0.7);
}

.credential-row {
  display: flex;
  gap: 8px;
}

.credentials-divider {
  margin: 12px 0;
  border: 0;
  border-top: 1px solid rgba(255, 255, 255, 0.08);
}

.credentials-rules-text {
  font-size: 11px;
  color: #7aa0b5;
  line-height: 1.45;
  margin: 8px 0 0;
}

.restore-divider {
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 10px;
  margin: 14px 0 10px;
  color: #3a6070;
  font-size: 16px;
  font-weight: 700;
  letter-spacing: 0.08em;
  text-transform: uppercase;
}

.restore-divider-line {
  flex: 1;
  height: 1px;
  background: rgba(255, 255, 255, 0.08);
}

.restore-key-row {
  display: flex;
  gap: 8px;
  margin-bottom: 8px;
}

.restore-key-input {
  flex: 1;
  height: 44px;
  background: rgba(0, 191, 255, 0.05);
  border: 1px solid rgba(0, 191, 255, 0.2);
  border-radius: 10px;
  color: #fff;
  /* 16px, NOT 14px: iOS Safari auto-zooms the viewport to any focused
     <input> whose computed font-size is below 16 CSS px. The paywall's
     alias/password/confirm fields sat at 14px, so focusing them zoomed
     the whole document and the zoom stuck after the paywall closed —
     exactly the "everything scaled up, edges clipped" symptom on menu
     pages, where the game never boots and the restrictive viewport
     meta is never installed (see index.html). */
  font-size: 16px;
  font-weight: 700;
  letter-spacing: 0.16em;
  text-align: center;
  text-transform: uppercase;
  transition: border-color 0.2s, box-shadow 0.2s;
}

.restore-key-input:focus {
  outline: none;
  border-color: #00bfff;
  box-shadow: 0 0 0 3px rgba(0, 191, 255, 0.15);
}

/* Live alias availability probe states */
.restore-key-input--available {
  border-color: #6fe0a0;
  box-shadow: 0 0 0 3px rgba(111, 224, 160, 0.18);
}

.restore-key-input--taken,
.restore-key-input--error {
  border-color: #ff6b6b;
  box-shadow: 0 0 0 3px rgba(255, 107, 107, 0.18);
}

.restore-key-input--checking {
  border-color: #ffb86c;
  box-shadow: 0 0 0 3px rgba(255, 184, 108, 0.18);
}

/* The recovery word is FREE TEXT, so it must not inherit the forced uppercase
   and wide letter-spacing above — that would render "my first dog" as an
   unreadable run of spaced capitals. Only those two properties are reset. */
.restore-key-input--word {
  text-transform: none;
  letter-spacing: 0.04em;
  border-color: rgba(255, 184, 108, 0.35);
}

.restore-key-input--word:focus {
  border-color: #ffb86c;
  box-shadow: 0 0 0 3px rgba(255, 184, 108, 0.18);
}

.restore-link-btn {
  margin-top: 12px;
  padding: 0;
  background: none;
  border: none;
  color: #00bfff;
  font-size: 13px;
  font-weight: 700;
  text-decoration: underline;
  cursor: pointer;
}

.restore-link-btn:hover {
  color: #7ec8ff;
}

.restore-key-note {
  font-size: 12px;
  line-height: 1.5;
  color: rgba(255, 255, 255, 0.6);
  margin: 8px 0 0 0;
}

.restore-key-btn {
  height: 44px;
  padding: 0 18px;
  background: linear-gradient(135deg, #00bfff 0%, #0099cc 100%);
  border: none;
  border-radius: 10px;
  color: #040d14;
  font-weight: 700;
  font-size: 13px;
  cursor: pointer;
}

.restore-key-btn:disabled {
  opacity: 0.4;
  cursor: not-allowed;
}

.restore-key-hint {
  font-size: 11px;
  color: #5d8499;
  margin: 6px 0;
  line-height: 1.4;
  min-height: 16px;
}

.restore-key-error {
  color: #ff8099;
  font-size: 12px;
  margin: 6px 0;
}

.restore-key-success {
  color: #6fe0a0;
  font-size: 12px;
  margin: 6px 0;
}

.continue-free-divider {
  display: flex;
  align-items: center;
  gap: 10px;
  margin: 14px 0 10px;
  color: #3a6070;
  font-size: 11px;
  letter-spacing: 0.08em;
  text-transform: uppercase;
}

.continue-free-divider-line {
  flex: 1;
  height: 1px;
  background: rgba(255, 255, 255, 0.08);
}

.continue-free-btn {
  width: 100%;
  margin-top: 10px;
  padding: 12px;
  background: transparent;
  border: 1px solid rgba(255, 255, 255, 0.12);
  border-radius: 10px;
  color: #7aa0b5;
  font-size: 13px;
  cursor: pointer;
  transition: all 0.2s;
}

.continue-free-btn:hover {
  background: rgba(255, 255, 255, 0.05);
  color: #fff;
}

.continue-free-note {
  margin: 10px 0 0;
  font-size: 11.5px;
  line-height: 1.5;
  color: #56788c;
  text-align: center;
}

/* Account actions: switch account available for all users, start fresh only for premium */
.account-actions {
  margin: 14px 0 0;
  display: flex;
  flex-direction: column;
  gap: 8px;
}

.switch-account-btn,
.start-fresh-btn {
  width: 100%;
  padding: 10px 14px;
  border-radius: 8px;
  font-size: 13px;
  font-weight: 600;
  cursor: pointer;
  transition: all 0.15s ease;
}

.switch-account-btn {
  background: rgba(0, 191, 255, 0.08);
  border: 1px solid rgba(0, 191, 255, 0.3);
  color: #00bfff;
}

.switch-account-btn:hover:not(:disabled) {
  background: rgba(0, 191, 255, 0.15);
  border-color: rgba(0, 191, 255, 0.5);
}

.switch-account-btn:disabled {
  opacity: 0.6;
  cursor: default;
}

.start-fresh-btn {
  background: rgba(255, 100, 100, 0.06);
  border: 1px solid rgba(255, 100, 100, 0.25);
  color: #ff6b6b;
}

.start-fresh-btn:hover {
  background: rgba(255, 100, 100, 0.12);
  border-color: rgba(255, 100, 100, 0.45);
}

.paywall-fade-enter-active,
.paywall-fade-leave-active {
  transition: opacity 0.25s ease;
}
.paywall-fade-enter-from,
.paywall-fade-leave-to {
  opacity: 0;
}

/* Disclaimer modal */
.disclaimer-card {
  background: #071520;
  border: 1px solid rgba(0, 191, 255, 0.3);
  border-radius: 20px;
  padding: 32px 28px 28px;
  max-width: 400px;
  width: 100%;
  box-shadow: 0 30px 80px rgba(0, 0, 0, 0.7);
  text-align: center;
}

.disclaimer-title {
  font-size: 20px;
  font-weight: 700;
  color: #fff;
  margin: 0 0 14px;
}

.disclaimer-body {
  font-size: 13px;
  color: #7aa0b5;
  line-height: 1.55;
  margin: 0 0 22px;
}

.disclaimer-body strong {
  color: #00bfff;
  font-family: ui-monospace, SFMono-Regular, Menlo, monospace;
}

.disclaimer-actions {
  display: flex;
  gap: 12px;
  justify-content: center;
}

.disclaimer-btn {
  flex: 1;
  height: 48px;
  border: none;
  border-radius: 12px;
  font-weight: 700;
  font-size: 15px;
  cursor: pointer;
}

.disclaimer-disreagard {
  background: rgba(255, 80, 80, 0.85);
  color: #fff;
}

.disclaimer-roger {
  background: linear-gradient(135deg, #06c463 0%, #23ad61 100%);
  color: #040d14;
}

/* Sync overlay — blocks all interaction while waiting for server account confirmation */
.sync-overlay {
  position: absolute;
  inset: 0;
  z-index: 100;
  display: flex;
  align-items: center;
  justify-content: center;
  background: rgba(4, 13, 20, 0.92);
  backdrop-filter: blur(6px);
  border-radius: 20px;
}

.sync-modal {
  text-align: center;
  padding: 32px 28px;
  max-width: 340px;
  width: 100%;
}

.sync-spinner {
  width: 48px;
  height: 48px;
  margin: 0 auto 20px;
  border: 3px solid rgba(0, 191, 255, 0.15);
  border-top-color: #00bfff;
  border-radius: 50%;
  animation: sync-spin 0.9s linear infinite;
}

@keyframes sync-spin {
  to {
    transform: rotate(360deg);
  }
}

/* A request is running (isBusy): every control looks inactive and ignores touches
   (blockWhileBusy drops the rest), except the pressed one, which keeps full opacity
   and shows the spinner. The panel itself still scrolls. Scoped, so the web checkout
   rendered into #rc-web-checkout-container is not matched. */
.paywall-panel--busy button,
.paywall-panel--busy input,
.paywall-panel--busy .key-display-value {
  pointer-events: none;
  opacity: 0.5;
}

.paywall-panel--busy button.is-pending {
  opacity: 1;
  cursor: progress;
}

.btn-spinner {
  display: inline-block;
  width: 1em;
  height: 1em;
  margin-right: 0.5em;
  vertical-align: -0.15em;
  border: 2px solid currentColor;
  border-right-color: transparent;
  border-radius: 50%;
  animation: sync-spin 0.7s linear infinite;
}

.sync-title {
  font-size: 18px;
  font-weight: 700;
  color: #fff;
  margin: 0 0 10px;
}

.sync-body {
  font-size: 13.5px;
  color: #7aa0b5;
  line-height: 1.55;
  margin: 0 0 14px;
}

.sync-hint {
  font-size: 12px;
  color: #5d8499;
  font-weight: 500;
  margin: 0;
}

/* Character validation display */
.char-validation {
  display: flex;
  flex-wrap: wrap;
  gap: 4px;
  justify-content: center;
  margin-top: 6px;
  min-height: 28px;
}

.char-badge {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  min-width: 24px;
  height: 24px;
  border-radius: 4px;
  font-size: 12px;
  font-weight: 700;
  font-family: ui-monospace, SFMono-Regular, Menlo, monospace;
  letter-spacing: 0;
  text-transform: uppercase;
  transition: all 0.15s ease;
}

.char-badge.valid {
  background: rgba(111, 224, 160, 0.2);
  color: #6fe0a0;
  border: 1px solid rgba(111, 224, 160, 0.4);
}

.char-badge.invalid {
  background: rgba(255, 77, 109, 0.25);
  color: #ff6b6b;
  border: 1px solid rgba(255, 77, 109, 0.5);
  animation: char-shake 0.3s ease;
}

@keyframes char-shake {
  0%,
  100% {
    transform: translateX(0);
  }
  25% {
    transform: translateX(-2px);
  }
  75% {
    transform: translateX(2px);
  }
}

/* Debug toggle button in header */
.debug-toggle-btn {
  margin-top: 12px;
  padding: 8px 12px;
  background: rgba(0, 191, 255, 0.1);
  border: 1px solid rgba(0, 191, 255, 0.3);
  border-radius: 8px;
  color: #00bfff;
  font-size: 12px;
  font-weight: 600;
  cursor: pointer;
  transition: all 0.2s;
}
.debug-toggle-btn:hover {
  background: rgba(0, 191, 255, 0.2);
  border-color: rgba(0, 191, 255, 0.5);
}

/* Full debug panel */
.debug-panel--full {
  background: rgba(0, 20, 40, 0.98);
  color: #7ec8ff;
  font-family: monospace;
  padding: 12px;
  border-radius: 8px;
  margin: 12px 0;
  font-size: 10px;
  line-height: 1.5;
  border: 1px solid rgba(0, 191, 255, 0.4);
  word-break: break-all;
  max-height: 400px;
  overflow-y: auto;
}

.debug-panel--full .debug-panel-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  margin-bottom: 8px;
  padding-bottom: 8px;
  border-bottom: 1px solid rgba(0, 191, 255, 0.3);
}

.debug-panel--full .debug-clear-btn {
  padding: 4px 8px;
  background: rgba(255, 80, 80, 0.8);
  border: none;
  border-radius: 4px;
  color: #fff;
  font-size: 10px;
  cursor: pointer;
}

.debug-panel--full .debug-section {
  margin-bottom: 10px;
  padding-bottom: 8px;
  border-bottom: 1px dashed rgba(0, 191, 255, 0.15);
}

.debug-panel--full .debug-section:last-child {
  border-bottom: none;
}

.debug-panel--full .debug-section strong {
  color: #00bfff;
}

.debug-panel--full .payment-logs {
  max-height: 150px;
  overflow-y: auto;
  margin-top: 4px;
}

.debug-panel--full .log-entry {
  padding: 2px 0;
  font-family: monospace;
  font-size: 9px;
  line-height: 1.4;
  border-left: 2px solid rgba(0, 191, 255, 0.2);
  padding-left: 6px;
  margin: 2px 0;
}
</style>
