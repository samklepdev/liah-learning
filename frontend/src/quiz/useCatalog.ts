import { useOutletContext } from 'react-router';
import type { SubjectSummary } from './api';

export type CatalogContext = { subjects: SubjectSummary[] };

/**
 * The subject list fetched once by CatalogLayout. Lives apart from the layout
 * component so that file only exports components — Fast Refresh needs that.
 */
export function useCatalog(): CatalogContext {
  return useOutletContext<CatalogContext>();
}
