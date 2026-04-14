import bodyComposition from './body-composition-dynamics/index.ts';
import type { ReportDefinition } from './types.ts';

const registry = new Map<string, ReportDefinition<any, any>>();

function register(def: ReportDefinition<any, any>) {
  registry.set(def.id, def);
}

register(bodyComposition);

export const getReport = (id: string) => registry.get(id);
export const listReports = () => [...registry.values()];
