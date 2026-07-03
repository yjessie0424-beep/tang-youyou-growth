const ICONS = {
  spark: `<svg viewBox="0 0 24 24" fill="none" aria-hidden="true"><path d="M12 2l1.2 5.1L18 9l-4.8 1.9L12 16l-1.2-5.1L6 9l4.8-1.9L12 2Z" stroke="currentColor" stroke-width="1.6" stroke-linejoin="round"/></svg>`,
  calendar: `<svg viewBox="0 0 24 24" fill="none" aria-hidden="true"><path d="M7 3v3M17 3v3" stroke="currentColor" stroke-width="1.6" stroke-linecap="round"/><path d="M4.5 8h15" stroke="currentColor" stroke-width="1.6" stroke-linecap="round"/><path d="M6.5 5.5h11A2.5 2.5 0 0 1 20 8v11a2.5 2.5 0 0 1-2.5 2.5h-11A2.5 2.5 0 0 1 4 19V8a2.5 2.5 0 0 1 2.5-2.5Z" stroke="currentColor" stroke-width="1.6" stroke-linejoin="round"/></svg>`,
  heart: `<svg viewBox="0 0 24 24" fill="none" aria-hidden="true"><path d="M12 20s-7-4.4-9.2-9.1C1 7.5 3 4.8 6 4.5c1.7-.2 3.3.6 4.2 2 1-1.4 2.5-2.2 4.2-2 3 .3 5 3 3.2 6.4C19 15.6 12 20 12 20Z" stroke="currentColor" stroke-width="1.6" stroke-linejoin="round"/></svg>`,
  horse: `<svg viewBox="0 0 24 24" fill="none" aria-hidden="true"><path d="M6 20v-6.2c0-2.2 1-4.2 2.7-5.5L12 5l2.8 2.1c1.7 1.3 2.7 3.3 2.7 5.5V20" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"/><path d="M9.2 10.8h5.6" stroke="currentColor" stroke-width="1.6" stroke-linecap="round"/><path d="M8 5.6 6.2 4.2M16 5.6l1.8-1.4" stroke="currentColor" stroke-width="1.6" stroke-linecap="round"/></svg>`,
  girl: `<svg viewBox="0 0 24 24" fill="none" aria-hidden="true"><path d="M12 12.5a4 4 0 1 0-4-4 4 4 0 0 0 4 4Z" stroke="currentColor" stroke-width="1.6"/><path d="M6 21a6 6 0 0 1 12 0" stroke="currentColor" stroke-width="1.6" stroke-linecap="round"/><path d="M7.5 13.5 6 16M16.5 13.5 18 16" stroke="currentColor" stroke-width="1.6" stroke-linecap="round"/></svg>`
};

function $(selector, root = document) {
  return root.querySelector(selector);
}

function el(tag, attrs = {}, children = []) {
  const node = document.createElement(tag);
  for (const [key, value] of Object.entries(attrs)) {
    if (key === "class") node.className = value;
    else if (key === "html") node.innerHTML = value;
    else if (key.startsWith("on") && typeof value === "function") {
      node.addEventListener(key.slice(2), value);
    } else if (value === true) node.setAttribute(key, "");
    else if (value !== false && value != null) node.setAttribute(key, String(value));
  }
  for (const child of children) node.append(child);
  return node;
}

function clampVideo(video, clipSeconds) {
  if (!clipSeconds) return;
  const clipEnd = Number(clipSeconds);
  if (!Number.isFinite(clipEnd) || clipEnd <= 0) return;
  video.addEventListener("timeupdate", () => {
    if (video.currentTime >= clipEnd) {
      video.pause();
      video.currentTime = 0;
    }
  });
}

function openLightbox({ kind, url }) {
  const lightbox = $("#lightbox");
  const panel = $("#lightbox-panel");
  panel.replaceChildren();

  if (kind === "video") {
    const video = el("video", {
      src: url,
      controls: true,
      playsinline: true,
      preload: "metadata"
    });
    panel.append(video);
  } else {
    const img = el("img", { src: url, alt: "" });
    panel.append(img);
  }

  lightbox.style.display = "grid";
  document.body.style.overflow = "hidden";
}

function closeLightbox() {
  const lightbox = $("#lightbox");
  const panel = $("#lightbox-panel");
  lightbox.style.display = "none";
  panel.replaceChildren();
  document.body.style.overflow = "";
}

function setupActiveNav() {
  const navLinks = [...document.querySelectorAll("[data-nav] a[href^=\"#\"]")];
  const sections = navLinks
    .map((a) => document.getElementById(a.getAttribute("href").slice(1)))
    .filter(Boolean);

  const byId = new Map(navLinks.map((a) => [a.getAttribute("href").slice(1), a]));

  const observer = new IntersectionObserver(
    (entries) => {
      const visible = entries
        .filter((e) => e.isIntersecting)
        .sort((a, b) => b.intersectionRatio - a.intersectionRatio)[0];
      if (!visible) return;
      for (const a of navLinks) a.setAttribute("aria-current", "false");
      byId.get(visible.target.id)?.setAttribute("aria-current", "true");
    },
    { rootMargin: "-20% 0px -70% 0px", threshold: [0.06, 0.12, 0.2] }
  );
  sections.forEach((section) => observer.observe(section));
}

function setupDrawer() {
  const openBtn = $("#open-drawer");
  const drawer = $("#drawer");
  const backdrop = $("#drawer-backdrop");
  const panel = $("#drawer-panel");
  const closeAll = () => {
    document.body.classList.remove("drawer-open");
  };
  openBtn.addEventListener("click", () => {
    document.body.classList.add("drawer-open");
  });
  backdrop.addEventListener("click", closeAll);
  panel.addEventListener("click", (e) => {
    const link = e.target.closest("a[href^=\"#\"]");
    if (link) closeAll();
  });
  window.addEventListener("keydown", (e) => {
    if (e.key === "Escape") closeAll();
  });
}

function setupLightbox() {
  $("#lightbox-close").addEventListener("click", closeLightbox);
  $("#lightbox-backdrop").addEventListener("click", closeLightbox);
  window.addEventListener("keydown", (e) => {
    if (e.key === "Escape") closeLightbox();
  });
}

function setupCarousel({ track, dots, intervalMs }) {
  const items = [...track.children];
  if (!items.length) return () => {};
  let index = 0;
  let timer = null;
  let interacted = false;

  function render() {
    track.style.transform = `translateX(${-index * 100}%)`;
    [...dots.children].forEach((dot, i) =>
      dot.setAttribute("aria-current", i === index ? "true" : "false")
    );
  }

  function next() {
    index = (index + 1) % items.length;
    render();
  }

  function start() {
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;
    if (timer) return;
    timer = window.setInterval(next, intervalMs);
  }

  function stop() {
    if (!timer) return;
    window.clearInterval(timer);
    timer = null;
  }

  render();
  start();

  const onInteract = () => {
    if (interacted) return;
    interacted = true;
    stop();
  };
  track.addEventListener("pointerdown", onInteract, { passive: true });
  track.addEventListener("touchstart", onInteract, { passive: true });

  return { next, start, stop };
}

async function main() {
  const response = await fetch("./content.json", { cache: "no-store" });
  const content = await response.json();

  document.title = `${content.hero.title} - ${content.profile.name}`;
  document
    .querySelectorAll('[data-bind="brand-title"]')
    .forEach((node) => (node.textContent = content.hero.title));
  document
    .querySelectorAll('[data-bind="brand-subtitle"]')
    .forEach((node) => (node.textContent = content.hero.subtitle));
  $("#topbar-title").textContent = content.profile.name;

  // Hero
  $("#hero-title").textContent = content.hero.title;
  $("#hero-subtitle").textContent = content.hero.subtitle;

  const tags = $("#hero-tags");
  tags.replaceChildren(
    el("span", { class: "tag", html: `${ICONS.girl}<span>${content.profile.gender}</span>` }),
    el("span", {
      class: "tag",
      html: `${ICONS.calendar}<span>出生 ${content.profile.birthDate}</span>`
    }),
    el("span", {
      class: "tag",
      html: `${ICONS.spark}<span>${content.profile.lunarBirth}</span>`
    }),
    el("span", {
      class: "tag",
      html: `${ICONS.horse}<span>属${content.profile.zodiac}</span>`
    }),
    el("span", {
      class: "tag",
      html: `${ICONS.heart}<span>${content.profile.lucky}</span>`
    })
  );

  // Cover carousel
  const coverTrack = $("#cover-track");
  const coverDots = $("#cover-dots");
  coverTrack.replaceChildren(
    ...content.cover.map((item) =>
      el("div", { class: "carousel-item" }, [
        el("img", {
          src: item.url,
          alt: "",
          loading: "eager",
          decoding: "async"
        })
      ])
    )
  );
  coverDots.replaceChildren(
    ...content.cover.map((_, idx) =>
      el("span", { class: "dot", "aria-current": idx === 0 ? "true" : "false" })
    )
  );
  setupCarousel({ track: coverTrack, dots: coverDots, intervalMs: 6000 });

  // Months timeline
  const timeline = $("#months-timeline");
  timeline.replaceChildren(
    ...content.months.map((item) => {
      const monthNo = Number(item.filename.match(/^(\d+)/)?.[1] ?? "");
      return el("div", { class: "card timeline-item" }, [
        el("div", { class: "month-pill" }, [document.createTextNode(`第${monthNo}个月`)]),
        el("div", { class: "media-thumb" }, [
          el("img", { src: item.url, alt: "", loading: "lazy", decoding: "async" })
        ])
      ]);
    })
  );

  // Milestones
  const milestones = $("#milestones-grid");
  milestones.replaceChildren(
    ...content.milestones.map((item) => {
      const media =
        item.kind === "video"
          ? (() => {
              const video = el("video", {
                src: item.url,
                controls: true,
                playsinline: true,
                preload: "metadata"
              });
              clampVideo(video, item.clipSeconds ?? 15);
              return video;
            })()
          : el("img", { src: item.url, alt: "", loading: "lazy", decoding: "async" });

      const badge =
        item.kind === "video"
          ? el("span", { class: "badge" }, [
              document.createTextNode("只展示"),
              el("strong", {}, [document.createTextNode(`${item.clipSeconds ?? 15}s`)])
            ])
          : el("span", { class: "badge" }, [document.createTextNode("照片")]);

      return el("article", { class: "card milestone-card" }, [
        el("div", { class: "milestone-media" }, [media]),
        el("div", { class: "milestone-body" }, [
          el("h3", { class: "milestone-title" }, [document.createTextNode(item.title)]),
          el("div", { class: "milestone-meta" }, [
            el("span", {}, [document.createTextNode(item.date)]),
            badge
          ])
        ])
      ]);
    })
  );

  // Letters
  const letters = $("#letters-grid");
  letters.replaceChildren(
    ...content.letters.map((item) =>
      el("article", { class: "card letter-card" }, [
        el("h3", { class: "letter-title" }, [document.createTextNode(item.title)]),
        item.date ? el("div", { class: "letter-date" }, [document.createTextNode(item.date)]) : "",
        el(
          "div",
          { class: "chips" },
          (item.keywords ?? []).map((keyword) => el("span", { class: "chip" }, [keyword]))
        ),
        el("div", { class: "letter-summary" }, [document.createTextNode(item.summary ?? "")]),
        el("a", { class: "btn", href: item.url }, [document.createTextNode("查看全文")])
      ])
    )
  );

  // Love gallery
  const gallery = $("#love-gallery");
  gallery.replaceChildren(
    ...content.love.map((item) => {
      const media =
        item.kind === "video"
          ? el("video", { src: item.url, muted: true, playsinline: true, preload: "metadata" })
          : el("img", { src: item.url, alt: "", loading: "lazy", decoding: "async" });
      return el(
        "div",
        {
          class: "gallery-item",
          role: "button",
          tabindex: "0",
          onclick: () => openLightbox(item),
          onkeydown: (e) => {
            if (e.key === "Enter" || e.key === " ") openLightbox(item);
          }
        },
        [media]
      );
    })
  );

  $("#generated-at").textContent = new Date(content.meta.generatedAt).toLocaleString("zh-CN", {
    hour12: false
  });

  setupActiveNav();
  setupDrawer();
  setupLightbox();
}

main().catch((error) => {
  // eslint-disable-next-line no-console
  console.error(error);
  $("#app-error").textContent = "内容加载失败：请先运行生成脚本（npm run generate）并用本地服务器打开。";
});
