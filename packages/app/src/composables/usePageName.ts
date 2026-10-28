import { computed } from 'vue';
import { useRoute } from 'vue-router';

export const ROUTE_TO_PAGE: Record<string, string> = {
  Intro: '',
  Home: 'home',
  Menu: 'menu',
  Main: 'main',
  PlayFields: 'play-fields',
  Airfields: 'airfields', // legacy
  AirportShifts: 'airport-shifts',
  ControlCenter: 'control-center', // +
  // ControlCenter2: 'control-center-2', // +
  FlightAcademy: 'flight-academy', // legacy
  TrainingCenter: 'training-center', // +
  Play: 'play', // +
  Game: 'game',
  Shop: 'shop',
  Leaderboard: 'leaderboard',
  main2: 'main2', // +
  Settings: 'settings', // legacy
  SystemConfig: 'system-config', // +
  Profile: 'profile',
  Level: 'level',
  Premium: 'premium',
  Questionnaire: 'questionnaire',
  AccountSettings: 'account-settings',
};

export function usePageName() {
  const route = useRoute();
  const pageName = computed(() => {
    const name = route.name as string | undefined;
    if (!name) return 'main';
    return ROUTE_TO_PAGE[name] ?? name.toLowerCase();
  });
  return { pageName };
}
