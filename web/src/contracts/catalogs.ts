// The signal and control catalogs, loaded from the repo's contracts/ folder (the single source of truth).
import controlCatalogJson from '@data/control-catalog.json';
import signalCatalogJson from '@data/signal-catalog.json';
import type { ControlCatalog, ControlInfo, SignalCatalog, SignalInfo } from './index';

export const signalCatalog = signalCatalogJson as unknown as SignalCatalog;
export const controlCatalog = controlCatalogJson as unknown as ControlCatalog;

export const signalInfo = (id: string): SignalInfo | undefined => signalCatalog.signals.find((s) => s.id === id);
export const controlInfo = (id: string): ControlInfo | undefined => controlCatalog.controls.find((c) => c.id === id);
