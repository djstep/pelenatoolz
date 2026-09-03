/** Base path for project resource catalog (under Settings). */
export function resourcesBasePath(locale: string, projectId: string) {
  return `/${locale}/projects/${projectId}/settings/resources`;
}

export function resourceCategoryPath(
  locale: string,
  projectId: string,
  categoryId: string,
) {
  return `${resourcesBasePath(locale, projectId)}/${categoryId}`;
}

export function resourceItemPath(
  locale: string,
  projectId: string,
  categoryId: string,
  itemId: string,
) {
  return `${resourceCategoryPath(locale, projectId, categoryId)}/items/${itemId}`;
}

export function resourcesRevalidatePaths(projectId: string) {
  const base = `/ru/projects/${projectId}/settings/resources`;
  return [base, `/ru/projects/${projectId}/resources`];
}
