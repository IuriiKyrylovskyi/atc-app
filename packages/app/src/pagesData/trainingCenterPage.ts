import { IStrip, strip, stripSubtitle, stripTitle, stripTraining } from './strips';
import { trainings as trainingsData } from './trainings';

const trainings = [
  stripTraining(trainingsData[0], true /* isGrounded */),
  stripTraining(trainingsData[1], true /* isGrounded */),
  stripTraining(trainingsData[2], true /* isGrounded */),
  stripTraining(trainingsData[3], true /* isGrounded */),
  stripTraining(trainingsData[4], true /* isGrounded */),
  stripTraining(trainingsData[5], true /* isGrounded */),
];

const trainingStrips = () => [
  stripTitle('titleTraininglCenter'),
  stripSubtitle('subtitleTrainingCenter'),
  ...trainings,
];
const trainingStripsExpand = () => [
  stripTitle('titleTraininglCenter'),
  stripSubtitle('subtitleTrainingCenter'),
  strip('ts3'),
  ...trainings,
];

// ---- desktop ----
// center
export const mainCenterStripsDesktop = (isPremium = false): IStrip[] => [...trainingStripsExpand()];

// ---- mobile ----
// !!! 14 strips in a column
// center
export const mainCenterStripsPortraitMobile = (isPremium = false): IStrip[] => [
  strip('s1'),
  strip('s2'),
  ...trainingStripsExpand(),
  strip('s13'),
  strip('s14'),
];

export const mainCenterStripsLandscapeMobile = (isPremium = false): IStrip[] => [strip('s1m'), ...trainingStrips()];
