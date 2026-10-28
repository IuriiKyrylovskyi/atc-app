import { ref } from 'vue';

const fromStripPage = ref(false);

export function useStripPageTransition() {
  return {
    fromStripPage,
    setFromStripPage: (val: boolean) => {
      fromStripPage.value = val;
    },
  };
}
