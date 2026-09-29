// Общие данные сайта: контакты, соцсети, меню. Меняются здесь — применяются во всех новых страницах.
// Старые страницы из Tilda (public/*.html) эти данные не читают — там правим вручную.

export const site = {
  name: 'Надеждик',
  url: 'https://nadezhdik.ru',
  description: 'Академия развития и спорта для детей от 2 до 17 лет',
  phone: { label: '8 800 101 8863', href: 'tel:+78001018863' },
  socials: [
    { label: 'ВКонтакте', href: 'https://vk.com/nadezhdik.project', icon: '/brand/vk.svg' },
    { label: 'Telegram', href: 'https://t.me/nadezhdik_project', icon: '/brand/telegram.svg' },
  ],
  legal: 'ООО «НАДЕЖДА». Все права защищены',
  credit: { label: 'Made with love at Noisy Brands', href: 'https://noisybrands.ru/', image: '/brand/made-with-love.svg' },
};

// Пункты бургер-меню. Пустые пока страницы (Dance, Football) не добавляем, пока на них нет контента.
export const nav = [
  { label: 'Главная', href: '/' },
  { label: 'Подготовка к школе', href: '/school/' },
  { label: 'English H club', href: '/english/' },
  { label: 'Документы', href: '/#docs' },
];
