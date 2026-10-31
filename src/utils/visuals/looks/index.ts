import { blobTrack } from './blob-track';
import { keys } from './keys';
import { domino } from './domino';
import { gonio } from './gonio';
import { scope } from './scope';
import { proof } from './proof';
import { campaign } from './campaign';
import { oracle } from './oracle';
import { weather } from './weather';
import { rack } from './rack';
import { orrery } from './orrery';
import { mosh } from './mosh';
import { blob } from './blob';
import { arcade } from './arcade';
import { receipt } from './receipt';
import { transit } from './transit';
import { lidar } from './lidar';
import { glyph } from './glyph';
import { totem } from './totem';
import { trajectory } from './trajectory';
import { stars } from './stars';
import { filament } from './filament';
import { monitor } from './monitor';
import { scan } from './scan';
import { smear } from './smear';
import { stipple } from './stipple';
import { chart } from './chart';
import { eclipse } from './eclipse';
import { ladder } from './ladder';
import { sheet } from './sheet';
import { screen } from './screen';
import { strip } from './strip';
import { monoStudio } from './mono-studio';
import { rageField } from './rage-field';
import { rageNight } from './rage-night';
import { trapPhosphor } from './trap-phosphor';
import { trapChrome } from './trap-chrome';
import { amaSun } from './ama-sun';
import { afroPaper } from './afro-paper';
import { plate } from './plate';
import { film } from './film';
import type { Look } from './types';

export type { Look, LookGroup } from './types';

// Library order: newest first, like the reference catalogue.
export const LOOK_LIST = [
  blobTrack,
  keys,
  domino,
  gonio,
  scope,
  proof,
  campaign,
  oracle,
  weather,
  rack,
  orrery,
  mosh,
  blob,
  arcade,
  receipt,
  transit,
  lidar,
  glyph,
  totem,
  trajectory,
  stars,
  filament,
  monitor,
  scan,
  smear,
  stipple,
  chart,
  eclipse,
  ladder,
  sheet,
  screen,
  strip,
  monoStudio,
  rageField,
  rageNight,
  trapPhosphor,
  trapChrome,
  amaSun,
  afroPaper,
  plate,
  film,
] as const satisfies readonly Look[];
