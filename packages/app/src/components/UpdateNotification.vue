<!-- packages/app/src/components/UpdateNotification.vue -->
<!-- Update notification component for all platforms -->

<script setup lang="ts">
import { ref, computed, watch } from 'vue';
import { VBtn, VCard, VIcon, VProgressLinear, VDivider, VCardItem } from 'vuetify/components';
import { useUpdateCheck } from '@/composables/useUpdateCheck';

const props = defineProps<{
  autoShow?: boolean;
  position?: 'top-right' | 'top-left' | 'bottom-right' | 'bottom-left';
}>();

const emit = defineEmits<{
  dismiss: [];
  update: [boolean];
}>();

const {
  state,
  downloadUpdate,
  installUpdate,
  cancelDownload,
  openUpdatePage,
  dismissUpdate,
  isElectron,
  isMobile,
  isWeb,
} = useUpdateCheck();

const show = ref(props.autoShow ?? true);
const downloading = ref(false);
const installing = ref(false);

const positionClasses = computed(() => {
  const base = 'fixed z-[1000] transition-all duration-300';
  const positions = {
    'top-right': 'top-4 right-4',
    'top-left': 'top-4 left-4',
    'bottom-right': 'bottom-4 right-4',
    'bottom-left': 'bottom-4 left-4',
  };
  return `${base} ${positions[props.position || 'top-right']}`;
});

const cardWidth = '380px';

const hasUpdate = computed(() => state.value.updateInfo?.available === true);
const updateInfo = computed(() => state.value.updateInfo);
const showProgress = computed(
  () => isElectron && (downloading.value || state.value.downloadProgress !== null)
);

// Computed for header - using MDI icon names as strings (Vuetify supports these natively)
const headerIcon = computed(() => {
  if (state.value.error) return 'mdi-alert-circle-outline';
  if (state.value.checking) return 'mdi-update';
  if (state.value.downloaded) return 'mdi-update';
  if (hasUpdate.value) return 'mdi-information-outline';
  return 'mdi-information-outline';
});

const headerTitle = computed(() => {
  if (state.value.error) return 'Update Check Failed';
  if (state.value.checking) return 'Checking for Updates';
  if (state.value.downloaded) return 'Update Ready';
  if (hasUpdate.value) return 'Update Available';
  return 'Up to Date';
});

const headerClass = computed(() => {
  if (state.value.error) return 'bg-error-container';
  if (state.value.downloaded) return 'bg-primary-container';
  if (hasUpdate.value) return 'bg-info-container';
  return 'bg-success-container';
});

// Auto-show when update becomes available
watch(
  () => state.value.updateInfo?.available,
  (available) => {
    if (available && props.autoShow) {
      show.value = true;
    }
  }
);

async function handleDownload(): Promise<void> {
  if (!isElectron) return;
  downloading.value = true;
  const success = await downloadUpdate();
  downloading.value = false;
  if (!success) {
    // Error handled by event listener
  }
}

async function handleInstall(): Promise<void> {
  if (!isElectron) return;
  installing.value = true;
  await installUpdate();
  // App will quit and install, so this may not complete
}

function handleCancel(): void {
  if (isElectron) {
    cancelDownload();
  }
  downloading.value = false;
}

function handleDismiss(): void {
  dismissUpdate();
  show.value = false;
  emit('dismiss');
}

function handleOpenStore(): void {
  openUpdatePage();
  // Don't dismiss - let user decide
}

function handleRemindLater(): void {
  show.value = false;
  // Will show again on next check interval
}
</script>

<template>
  <Teleport to="body">
    <Transition name="update-notification">
      <div v-if="show && (hasUpdate || state.downloaded || downloading)" :class="positionClasses">
        <VCard
          :style="{ width: cardWidth, maxWidth: '90vw' }"
          class="pa-0 overflow-hidden"
          elevation="8"
          variant="tonal"
          color="surface"
        >
          <!-- Header -->
          <VCardItem class="px-4 py-3 flex items-center justify-between" :class="headerClass">
            <div class="flex items-center gap-2">
              <VIcon :icon="headerIcon" size="24" />
              <span class="font-weight-medium text-h6">{{ headerTitle }}</span>
            </div>
            <VBtn icon size="x-small" variant="text" class="text-on-surface" @click="handleDismiss">
              <VIcon icon="mdi-close" size="20" />
            </VBtn>
          </VCardItem>

          <VDivider />

          <!-- Content -->
          <VCardItem class="px-4 py-3">
            <div v-if="state.checking" class="flex items-center gap-3">
              <VIcon icon="mdi-update" size="24" class="text-primary" />
              <span>Checking for updates...</span>
            </div>

            <div v-else-if="state.error" class="flex items-center gap-3">
              <VIcon icon="mdi-alert-circle-outline" size="24" class="text-error" />
              <span class="text-body-2">Failed to check for updates</span>
            </div>

            <div v-else-if="(hasUpdate || state.downloaded) && updateInfo" class="space-y-3">
              <div>
                <p class="text-body-1 mb-1">
                  Version <strong>{{ updateInfo.latestVersion }}</strong> is available
                  <span v-if="updateInfo.currentVersion !== updateInfo.latestVersion">
                    (current: {{ updateInfo.currentVersion }})
                  </span>
                </p>
                <p v-if="updateInfo.releaseNotes" class="text-body-2 text-on-surface-variant">
                  {{ updateInfo.releaseNotes }}
                </p>
              </div>

              <!-- Download progress (Electron) -->
              <div v-if="showProgress" class="space-y-2">
                <VProgressLinear
                  :model-value="state.downloadProgress || 0"
                  color="primary"
                  height="6"
                  rounded
                />
                <div class="flex justify-between text-caption">
                  <span>Downloading... {{ state.downloadProgress || 0 }}%</span>
                  <VBtn size="x-small" variant="text" @click="handleCancel"> Cancel </VBtn>
                </div>
              </div>

              <!-- Actions -->
              <div class="flex gap-2 mt-2">
                <VBtn
                  v-if="isElectron && !state.downloaded && !downloading"
                  color="primary"
                  :loading="downloading"
                  class="flex-1"
                  @click="handleDownload"
                >
                  <VIcon icon="mdi-download" start size="18" />
                  Download Update
                </VBtn>

                <VBtn
                  v-if="isElectron && state.downloaded && !installing"
                  color="primary"
                  :loading="installing"
                  class="flex-1"
                  @click="handleInstall"
                >
                  <VIcon icon="mdi-update" start size="18" />
                  Install & Restart
                </VBtn>

                <VBtn
                  v-if="isMobile || isWeb"
                  color="primary"
                  class="flex-1"
                  @click="handleOpenStore"
                >
                  <VIcon
                    :icon="isMobile ? 'mdi-information-outline' : 'mdi-update'"
                    start
                    size="18"
                  />
                  {{ isMobile ? 'Open App Store' : 'View Release' }}
                </VBtn>

                <VBtn variant="outlined" class="flex-1" @click="handleRemindLater">
                  Remind Later
                </VBtn>
              </div>
            </div>

            <div v-else-if="!hasUpdate && !state.checking && !state.error" class="text-center py-2">
              <VIcon icon="mdi-information-outline" size="24" class="text-success mb-2" />
              <p class="text-body-2">
                You're on the latest version ({{ state.updateInfo?.currentVersion || 'unknown' }})
              </p>
            </div>
          </VCardItem>
        </VCard>
      </div>
    </Transition>
  </Teleport>
</template>

<style scoped>
.update-notification-enter-active,
.update-notification-leave-active {
  transition: all 0.3s ease;
}

.update-notification-enter-from,
.update-notification-leave-to {
  opacity: 0;
  transform: translateY(-16px);
}
</style>
