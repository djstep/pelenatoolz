import type { NavGroup } from "@/features/projects/components/project-nav";

export const projectNavGroups: NavGroup[] = [
  {
    id: "home",
    items: [
      { href: "", label: "Обзор" },
      { href: "/screenplay", label: "Сценарий" },
      { href: "/files", label: "Файлы" },
    ],
  },
  {
    id: "preproduction",
    title: "Препродакшн",
    items: [
      { href: "/preproduction/casting", label: "Кастинг" },
      { href: "/preproduction/scout", label: "Скаут" },
    ],
  },
  {
    id: "resources",
    title: "Ресурсы",
    items: [{ href: "/resources", label: "Категории" }],
  },
  {
    id: "planning",
    title: "Планирование",
    defaultOpen: true,
    items: [
      { href: "/libretto", label: "Сцены (либретто)" },
      { href: "/locations", label: "Локации" },
      { href: "/characters", label: "Персонажи" },
      { href: "/schedule", label: "КПП" },
      { href: "/schedule/availability", label: "Занятость" },
      { href: "/call-sheets", label: "Вызывные" },
    ],
  },
  {
    id: "finance",
    title: "Финансы",
    items: [
      { href: "/reports", label: "Отчёты" },
      { href: "/budget", label: "Смета" },
      { href: "/finance", label: "Финансы" },
    ],
  },
  {
    id: "post",
    title: "Постпродакшн",
    emptyHint: "Раздел в разработке — модули появятся позже.",
    items: [],
  },
  {
    id: "settings",
    title: "Настройки",
    items: [
      { href: "/members", label: "Участники" },
      { href: "/roles", label: "Роли и права" },
      { href: "/settings", label: "Настройки проекта" },
      { href: "/audit", label: "Журнал изменений" },
    ],
  },
];
