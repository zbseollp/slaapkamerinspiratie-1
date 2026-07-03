/**
 * Elementor nav-menu and search-form interactions for static Astro build.
 */
(function () {
  const DESKTOP_BREAKPOINT = 1025;

  function isDesktop() {
    return window.innerWidth >= DESKTOP_BREAKPOINT;
  }

  function initSubmenuArrows() {
    document.querySelectorAll('.menu-item-has-children > a').forEach((link) => {
      if (link.querySelector('.sub-arrow')) return;

      const arrow = document.createElement('span');
      arrow.className = 'sub-arrow';
      arrow.setAttribute('aria-hidden', 'true');
      arrow.innerHTML = '<i class="fas fa-caret-down" aria-hidden="true"></i>';
      link.appendChild(arrow);

      link.setAttribute('aria-haspopup', 'true');
      if (!link.hasAttribute('aria-expanded')) {
        link.setAttribute('aria-expanded', 'false');
      }
    });
  }

  function initMenuToggle() {
    document.querySelectorAll('.elementor-widget-nav-menu').forEach((widget) => {
      const toggle = widget.querySelector('.elementor-menu-toggle');
      const dropdown = widget.querySelector(
        '.elementor-menu-toggle + .elementor-nav-menu--dropdown'
      );
      if (!toggle || !dropdown || toggle.dataset.skiInit) return;
      toggle.dataset.skiInit = '1';

      function setOpen(open) {
        toggle.classList.toggle('elementor-active', open);
        widget.classList.toggle('elementor-active', open);
        toggle.setAttribute('aria-expanded', String(open));
        dropdown.setAttribute('aria-hidden', String(!open));
      }

      toggle.addEventListener('click', () => {
        const open = toggle.getAttribute('aria-expanded') !== 'true';
        setOpen(open);
      });

      toggle.addEventListener('keydown', (e) => {
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault();
          const open = toggle.getAttribute('aria-expanded') !== 'true';
          setOpen(open);
        }
      });
    });
  }

  function initDesktopSubmenus() {
    document.querySelectorAll('.elementor-nav-menu--main .menu-item-has-children').forEach((item) => {
      const link = item.querySelector(':scope > a');
      const submenu = item.querySelector(':scope > .sub-menu');
      if (!link || !submenu || item.dataset.skiDesktopInit) return;
      item.dataset.skiDesktopInit = '1';

      function showSubmenu() {
        if (!isDesktop()) return;
        submenu.style.display = 'block';
        link.classList.add('highlighted');
        link.setAttribute('aria-expanded', 'true');
      }

      function hideSubmenu() {
        if (!isDesktop()) return;
        submenu.style.display = '';
        link.classList.remove('highlighted');
        link.setAttribute('aria-expanded', 'false');
      }

      item.addEventListener('mouseenter', showSubmenu);
      item.addEventListener('mouseleave', hideSubmenu);
      link.addEventListener('focus', showSubmenu);
      item.addEventListener('focusout', (e) => {
        if (!item.contains(e.relatedTarget)) hideSubmenu();
      });
    });
  }

  function toggleMobileSubmenu(link) {
    const parent = link.parentElement;
    const submenu = parent?.querySelector(':scope > .sub-menu');
    if (!parent || !submenu) return;

    const isOpen = parent.classList.contains('elementor-sub-item-open');

    parent.parentElement
      ?.querySelectorAll(':scope > .menu-item-has-children.elementor-sub-item-open')
      .forEach((openItem) => {
        if (openItem !== parent) {
          openItem.classList.remove('elementor-sub-item-open');
          const openSub = openItem.querySelector(':scope > .sub-menu');
          if (openSub) openSub.style.display = '';
          const openLink = openItem.querySelector(':scope > a');
          openLink?.setAttribute('aria-expanded', 'false');
        }
      });

    parent.classList.toggle('elementor-sub-item-open', !isOpen);
    submenu.style.display = isOpen ? '' : 'block';
    link.setAttribute('aria-expanded', String(!isOpen));
  }

  function initMobileSubmenus() {
    document
      .querySelectorAll('.elementor-nav-menu--dropdown .menu-item-has-children > a')
      .forEach((link) => {
        if (link.dataset.skiMobileInit) return;
        link.dataset.skiMobileInit = '1';

        link.addEventListener('click', (e) => {
          if (isDesktop()) return;
          const parent = link.parentElement;
          const submenu = parent?.querySelector(':scope > .sub-menu');
          if (!parent || !submenu) return;

          const arrow = link.querySelector('.sub-arrow');
          const clickedArrow = arrow && arrow.contains(e.target);

          if (clickedArrow) {
            e.preventDefault();
            toggleMobileSubmenu(link);
            return;
          }

          if (!parent.classList.contains('elementor-sub-item-open')) {
            e.preventDefault();
            toggleMobileSubmenu(link);
          }
        });
      });
  }

  function initSearchForm() {
    document.querySelectorAll('.elementor-search-form').forEach((form) => {
      const widget = form.closest('.elementor-search-form--skin-full_screen');
      if (!widget || form.dataset.skiSearchInit) return;

      const toggle = form.querySelector('.elementor-search-form__toggle');
      const container = form.querySelector('.elementor-search-form__container');
      const input = form.querySelector('.elementor-search-form__input');
      const closeBtn = form.querySelector('.dialog-close-button');
      if (!toggle || !container) return;
      form.dataset.skiSearchInit = '1';

      function isOpen() {
        return container.classList.contains('elementor-search-form--full-screen');
      }

      function setOpen(open) {
        container.classList.toggle('elementor-search-form--full-screen', open);
        container.setAttribute('aria-hidden', String(!open));
        toggle.setAttribute('aria-expanded', String(open));
        document.body.classList.toggle('ski-search-open', open);

        if (open) {
          window.requestAnimationFrame(() => input?.focus());
        } else {
          input?.blur();
        }
      }

      toggle.addEventListener('click', (e) => {
        e.preventDefault();
        e.stopPropagation();
        setOpen(!isOpen());
      });

      closeBtn?.addEventListener('click', (e) => {
        e.preventDefault();
        e.stopPropagation();
        setOpen(false);
      });

      closeBtn?.addEventListener('keydown', (e) => {
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault();
          setOpen(false);
        }
      });

      toggle.addEventListener('keydown', (e) => {
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault();
          setOpen(!isOpen());
        }
      });

      // Close when clicking the dark overlay (anywhere except input/close button).
      container.addEventListener('click', (e) => {
        if (!isOpen()) return;
        if (e.target.closest('.elementor-search-form__input')) return;
        if (e.target.closest('.dialog-close-button')) return;
        setOpen(false);
      });

      document.addEventListener('keydown', (e) => {
        if (e.key === 'Escape' && isOpen()) {
          e.preventDefault();
          setOpen(false);
          toggle.focus();
        }
      });
    });
  }

  function resetMenusOnResize() {
    let wasDesktop = isDesktop();
    window.addEventListener('resize', () => {
      const nowDesktop = isDesktop();
      if (wasDesktop === nowDesktop) return;
      wasDesktop = nowDesktop;

      document.querySelectorAll('.elementor-nav-menu--main .sub-menu').forEach((submenu) => {
        submenu.style.display = '';
      });
      document.querySelectorAll('.elementor-nav-menu--main a.highlighted').forEach((link) => {
        link.classList.remove('highlighted');
      });
      document.querySelectorAll('.elementor-sub-item-open').forEach((item) => {
        item.classList.remove('elementor-sub-item-open');
        const submenu = item.querySelector(':scope > .sub-menu');
        if (submenu) submenu.style.display = '';
      });
    });
  }

  function init() {
    initSubmenuArrows();
    initMenuToggle();
    initDesktopSubmenus();
    initMobileSubmenus();
    initSearchForm();
    resetMenusOnResize();
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();
