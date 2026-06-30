(function () {
  if (!window.Vue || window.CheckinUITabsInstalled) return;
  window.CheckinUITabsInstalled = true;

  const originalCreateApp = window.Vue.createApp;
  const tabsComponent = {
    props: {
      items: {
        type: Array,
        default: () => [],
      },
    },
    methods: {},
    template: `
      <div class="nav">
        <a
          v-for="item in items"
          :key="item.key || item.href || item.label"
          :href="item.href"
          :class="{ active: !!item.active }"
        >{{ item.label }}</a>
      </div>
    `,
  };

  window.Vue.createApp = function (...args) {
    const app = originalCreateApp.apply(this, args);
    app.component("app-tabs", tabsComponent);
    return app;
  };
})();
