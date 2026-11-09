/**
 * Похоже ли значение на id проекта. id приходит из адреса и аргументов серверных действий, то
 * есть из браузера: туда можно подложить что угодно. Объект вроде `{ not: "x" }` Prisma принял бы
 * как фильтр и нашла бы чужую запись. Пропускаем только строку из букв, цифр, «-» и «_».
 */
const PROJECT_ID = /^[A-Za-z0-9_-]{1,64}$/;

export function isProjectId(value: unknown): value is string {
  return typeof value === "string" && PROJECT_ID.test(value);
}
