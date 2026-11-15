// 基础交互：导航菜单、主题切换、页脚年份。
const menuButton = document.querySelector('.menu-toggle');
const navigation = document.querySelector('#primary-nav');
const themeButton = document.querySelector('#theme-toggle');
const year = document.querySelector('#year');

if (menuButton && navigation) {
  menuButton.addEventListener('click', () => {
    const isOpen = navigation.classList.toggle('open');
    menuButton.setAttribute('aria-expanded', String(isOpen));
    menuButton.setAttribute('aria-label', isOpen ? '关闭导航菜单' : '打开导航菜单');
  });

  navigation.querySelectorAll('a').forEach((link) => {
    link.addEventListener('click', () => {
      navigation.classList.remove('open');
      menuButton.setAttribute('aria-expanded', 'false');
      menuButton.setAttribute('aria-label', '打开导航菜单');
    });
  });
}

if (themeButton) {
  themeButton.addEventListener('click', () => {
    const isDark = document.body.classList.toggle('dark');
    themeButton.setAttribute('aria-label', isDark ? '切换浅色模式' : '切换深色模式');
  });
}

if (year) year.textContent = String(new Date().getFullYear());
