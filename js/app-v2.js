/* B 版:叙事式餐厅站(v2.html 专用 fork) */
(function () {
  "use strict";
  var D = window.SISHALI_DATA;
  var $ = function (id) { return document.getElementById(id); };
  function esc(v) {
    return String(v == null ? "" : v).replace(/[&<>"']/g, function (ch) {
      return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[ch];
    });
  }

  /* ---------- 持久化 ---------- */
  var store = {
    get: function (k, def) {
      try { var v = localStorage.getItem(k); return v === null ? def : JSON.parse(v); }
      catch (e) { return def; }
    },
    set: function (k, v) {
      try { localStorage.setItem(k, JSON.stringify(v)); }
      catch (e) {
        if (!state._quotaAlerted && /quota/i.test(String(e))) {
          state._quotaAlerted = true;
          alert("本机存储空间已满(图片视频上传过多),部分新改动可能未保存。请清理后重试,或联系技术支持。");
        }
      }
    }
  };

  var state = {
    mode: store.get("sl_mode", "customer"),
    group: "menu",
    cat: "all",
    band: "all",
    cart: store.get("sl_cart", {}),
    soldout: store.get("sl_soldout", {}),
    dishImg: store.get("sl_dish_img", {}),
    dishVideo: store.get("sl_dish_video", {}),
    overrides: store.get("sl_overrides", {}),
    site: store.get("sl_site", {}),
    siteImg: store.get("sl_site_img", {}),
    mediaURLs: {},
    viewerIdx: 0,
    view: "home",
    table: null,
    unlocked: false,
    search: ""
  };
  function saveCart() { store.set("sl_cart", state.cart); }

  /* 运行时菜品表 = 内置 OCR 菜品(可隐藏) + 店家自定义菜品 */
  var CATS = D.categories;
  var DISHES = [];
  function buildDishes() {
    var custom = store.get("sl_custom", []);
    var hidden = store.get("sl_hidden", {});
    var nextId = 1;
    custom.forEach(function (c) { var n = parseInt((c.id || "x0").slice(1), 10); if (n >= nextId) nextId = n + 1; });
    DISHES = D.dishes.filter(function (d) { return !hidden[d.id]; }).concat(custom.map(function (c) {
      c.custom = true;
      c.priceText = c.price === null || c.price === undefined ? "时价" : "¥" + c.price;
      c.uncertain = false;
      return c;
    }));
    state.customNextId = nextId;
  }
  buildDishes();

  var todayKey = function () {
    var d = new Date();
    return "sl_orders_" + d.getFullYear() + String(d.getMonth() + 1).padStart(2, "0") + String(d.getDate()).padStart(2, "0");
  };

  var dishById = function (id) {
    for (var i = 0; i < DISHES.length; i++) if (DISHES[i].id === id) return DISHES[i];
    return null;
  };
  var catsOfGroup = function (g) { return CATS.filter(function (c) { return c.group === g; }); };
  var primaryPhone = function () {
    return state.site.phone || (state.overrides && state.overrides.phone) || D.store.phones[0].number;
  };

  /* ---------- 站点媒体(IndexedDB,支持大视频) ---------- */
  function idbOpen() {
    return new Promise(function (res, rej) {
      if (!window.indexedDB) return rej(new Error("no-idb"));
      var r = window.indexedDB.open("sishali_site", 1);
      r.onupgradeneeded = function () { r.result.createObjectStore("media"); };
      r.onsuccess = function () { res(r.result); };
      r.onerror = function () { rej(r.error); };
    });
  }
  function idbSet(k, v) {
    return idbOpen().then(function (db) {
      return new Promise(function (res, rej) {
        var tx = db.transaction("media", "readwrite");
        if (v === null) tx.objectStore("media").delete(k); else tx.objectStore("media").put(v, k);
        tx.oncomplete = function () { res(); }; tx.onerror = function () { rej(tx.error); };
      });
    });
  }
  function idbGet(k) {
    return idbOpen().then(function (db) {
      return new Promise(function (res, rej) {
        var rq = db.transaction("media", "readonly").objectStore("media").get(k);
        rq.onsuccess = function () { res(rq.result || null); };
        rq.onerror = function () { rej(rq.error); };
      });
    });
  }
  function hideVideoBlock(k) {
    if (k === "brandVideo") { var h = $("storeVideo2"); if (h && h.closest(".home-video")) h.closest(".home-video").hidden = true; }
    else { var p = $("parkingVideo"); if (p && p.closest(".visit-hero")) p.closest(".visit-hero").hidden = true; }
  }
  function applyMedia(k) {
    var rel = k === "brandVideo" ? "assets/video/store.mp4" : "assets/parking/parking.mp4";
    var localSrc = rel + "?v=4";
    var setUp = function (src) {
      if (k === "brandVideo") {
        var hv = $("heroBgVideo");
        if (!hv) return;
        hv.muted = true; hv.setAttribute("playsinline", ""); hv.setAttribute("muted", "");
        hv.src = src; $("storeVideo2") && ($("storeVideo2").src = src);
        tryHeroPlay(hv);
        hv.addEventListener("canplay", function () { tryHeroPlay(hv); });
        var bp = $("svBrandPreview"); if (bp) bp.src = src;
      } else {
        var pv = $("parkingVideo");
        pv.onerror = function () { if (!pv.dataset.fb) { pv.dataset.fb = 1; pv.src = localSrc; } };
        $("parkingVideo").src = src;
        var pp = $("svParkPreview"); if (pp) pp.src = src;
      }
    };
    if (state.mediaURLs[k]) { setUp(state.mediaURLs[k]); return; }
    fetch(localSrc, { method: "HEAD" }).then(function (r) {
      if (r.ok) setUp(localSrc); else hideVideoBlock(k);
    }).catch(function () { hideVideoBlock(k); });
  }
  function loadSiteMedia() {
    ["brandVideo", "parkingVideo"].forEach(applyMedia);
    /* 主视觉为纯设计方案(无视频):开屏 2.4 秒自动收起 */
    setTimeout(function () {
      var hv = $("heroBgVideo");
      if (!hv || !hv.currentSrc) dismissSplash();
    }, 2400);
    if (!window.indexedDB) return;
    ["brandVideo", "parkingVideo"].forEach(function (k) {
      idbGet(k).then(function (blob) {
        if (state.mediaURLs[k]) { URL.revokeObjectURL(state.mediaURLs[k]); state.mediaURLs[k] = null; }
        if (blob) state.mediaURLs[k] = URL.createObjectURL(blob);
        applyMedia(k);
      }).catch(function () {});
    });
  }

  document.addEventListener("error", function (e) {
    var t = e.target;
    if (t && t.classList && t.classList.contains("lazy-thumb") && t.dataset.full) {
      t.src = t.dataset.full; t.dataset.full = "";
    }
  }, true);
  function tryHeroPlay(hv) {
    if (!hv || hv.ended) return;
    hv.muted = true;
    var p = hv.play && hv.play();
    if (p && p.then) p.then(function () {
      window.removeEventListener("touchstart", heroKick);
      window.removeEventListener("click", heroKick);
      dismissSplash();
    }).catch(function () {});
  }
  function wxUnlock() {
    try {
      if (window.WeixinJSBridge && window.WeixinJSBridge.invoke) {
        window.WeixinJSBridge.invoke("getNetworkType", {}, function () {
          setTimeout(function () { tryHeroPlay(document.getElementById("heroBgVideo")); }, 80);
        });
      }
    } catch (e) {}
  }
  document.addEventListener("WeixinJSBridgeReady", function () { wxUnlock(); autoStartLadder(); }, false);
  wxUnlock();
  autoStartLadder();
  document.addEventListener("visibilitychange", function () {
    if (!document.hidden) setTimeout(function () { tryHeroPlay(document.getElementById("heroBgVideo")); }, 120);
  });
  function autoStartLadder() {
    if (state._ladder) return;
    state._ladder = true;
    var tries = 0;
    var timer = setInterval(function () {
      tries++;
      var hv = document.getElementById("heroBgVideo");
      if (!hv || !hv.paused || tries > 8) { clearInterval(timer); state._ladder = false; return; }
      hv.muted = true;
      if (tries === 3 && hv.load && hv.readyState === 0) hv.load();
      tryHeroPlay(hv);
    }, 450);
  }
  function dismissSplash() {
    var sp = document.getElementById("splash");
    if (!sp || sp.classList.contains("out")) return;
    sp.classList.add("out");
    setTimeout(function () { sp.hidden = true; }, 650);
  }
  var spBoot = setInterval(function () {
    var hv = document.getElementById("heroBgVideo");
    if (hv && !hv.paused) { dismissSplash(); clearInterval(spBoot); }
  }, 300);
  setTimeout(function () { clearInterval(spBoot); }, 12000);
  function heroKick() {
    var hv = document.getElementById("heroBgVideo");
    if (hv && hv.paused && hv.currentSrc) {
      if (hv.readyState === 0 && hv.load) hv.load();
      tryHeroPlay(hv);
    }
  }
  window.addEventListener("touchstart", heroKick, { passive: true });
  window.addEventListener("click", heroKick);

  /* ---------- 静态内容 ---------- */
  function siteVal(k, def) { return state.site[k] || def; }
  function renderStatic() {
    document.title = siteVal("brand", D.meta.brand) + " " + siteVal("branch", D.meta.branch);
    $("heroEn").textContent = siteVal("en", D.meta.brandEn);
    $("heroTitle").textContent = siteVal("brand", D.meta.brand);
    $("heroSlogan").textContent = "「" + siteVal("slogan", D.meta.slogan) + "」";
    var locParts = [D.store.city, D.store.district, D.store.mall, D.store.floor].filter(function (v) { return v && v !== "undefined"; });
    var sinceTxt = D.meta.since ? "Since " + D.meta.since : "";
    if (locParts.length) sinceTxt += (sinceTxt ? " · " : "") + locParts.join("");
    $("heroSince").textContent = sinceTxt;
    loadSiteMedia();

    $("locAddr").textContent = siteVal("addr", D.store.address);
    $("locAccess").textContent = siteVal("access", D.store.accessTip);
    $("infoCall").href = "tel:" + primaryPhone();
    var kw = encodeURIComponent(D.store.city + D.store.district + D.store.mall);
    $("mapAmap").href = "https://uri.amap.com/search?keyword=" + kw;
    $("mapBaidu").href = "https://map.baidu.com/search?query=" + kw;

    var info = [
      ["地址", siteVal("addr", D.store.address)],
      ["交通指引", siteVal("access", D.store.accessTip)],
      ["预订电话", primaryPhone()],
      ["服务经理(微信同号)", D.store.phones[1].number],
      ["包厢", store.get("sl_tables", []).concat(D.store.rooms || []).filter(function (v, i, a) { return a.indexOf(v) === i; }).join("、") || D.store.rooms.join("、")],
      ["营业时间", siteVal("hours", "以门店当日公示为准")]
    ];
    if (D.store.wifi && D.store.wifi.ssid) info.splice(4, 0, ["WiFi", siteVal("wifi", D.store.wifi.ssid + " / " + D.store.wifi.password)]);
    $("infoGrid").innerHTML = info.map(function (x) {
      return '<div class="info-item"><div class="k">' + x[0] + "</div><div class=\"v\">" + x[1] + "</div></div>";
    }).join("");
    $("footerMeta").textContent = "本单共 " + DISHES.length + " 项 · 时价菜品以门店当日公示为准 · 如有忌口或过敏食材请提前告知店家";

    var notice = siteVal("notice", (state.overrides && state.overrides.notice) || "");
    $("noticeBar").hidden = !notice;
    if (notice) $("noticeBar").textContent = "公告：" + notice;

    var hasDrinks = CATS.some(function (c) { return c.group === "drinks"; });
    var drinksBtn = $("groupTabs") && $("groupTabs").querySelector('[data-group="drinks"]');
    if (drinksBtn) drinksBtn.hidden = !hasDrinks;

    var ex = D.store.extras || {};
    $("parkingSteps").innerHTML = (ex.parkingSteps || []).map(function (s) { return "<li>" + s + "</li>"; }).join("");

    var awards = ex.awards || [];
    var haw = $("heroAwards");
    if (haw) haw.innerHTML = awards.map(function (a) { return "<span>" + esc(a) + "</span>"; }).join("");

    function gallery(el, list, label) {
      var one = list.map(function (src, i) {
        return '<figure><img loading="lazy" src="' + src + '" alt="' + label + (i + 1) + '">' +
          "<figcaption>" + label + "</figcaption></figure>";
      }).join("");
      if (!one) { el.innerHTML = ""; return; }
      el.innerHTML = '<div class="vg-track">' + one + one + "</div>";
      el.querySelectorAll("img").forEach(function (img) {
        img.onerror = function () {
          var f = img.closest("figure");
          f.innerHTML = '<div class="img-pending">待店家提供</div>';
        };
      });
    }
    gallery($("envGallery"), (ex.envImages || []).map(function (p, i) { return state.siteImg["env" + (i + 1)] || p; }), "店内环境");
    gallery($("recGallery"), (ex.recommendImages || []).map(function (p, i) { return state.siteImg["rec" + (i + 1)] || p; }), "推荐菜品");

    /* B 版:首页叙事章节 */
    $("mfSlogan").textContent = siteVal("slogan", D.meta.slogan);
    $("mfText").textContent = siteVal("manifesto", "取食材之鲜，传承经典之肴，细烹淳朴之味，创新闽南之光。\n典雅舒适、独立私密——私厦里经典，一菜一饭一汤。");
    $("homeAddrShort").innerHTML = D.store.address + "<br>" + primaryPhone();
    var feats = featCandidates();
    $("homeFeat").innerHTML = feats.slice(0, 3).map(function (d, i) {
      var m = mediaOf(d);
      var inner = m.img ? '<img loading="lazy" src="' + m.img + '" alt="' + d.name + '">'
        : '<div class="thumb-ph" style="--h:' + hueOf(d.id) + '">' + d.name.charAt(0) + "</div>";
      return '<div class="chapter rv' + (i % 2 ? " rev" : "") + '">' +
        '<div class="ch-media" data-thumb="' + d.id + '">' + inner + (m.video ? '<span class="play-badge">▶</span>' : "") + "</div>" +
        '<div class="ch-text"><i>0' + (i + 1) + "</i><h3>" + d.name + "</h3>" +
        '<p class="ch-price">' + priceHtml(d) + "</p>" +
        '<div class="ch-add">' + addButtons(d, state.soldout[d.id]) + "</div></div></div>";
    }).join("");
    var envImgs = (D.store.extras && D.store.extras.envImages) || [];
    var envSrc = function (i) { return state.siteImg["env" + (i + 1)] || envImgs[i]; };
    $("homeStrip").innerHTML = envImgs.slice(0, 3).map(function (_, i) {
      return '<figure><img loading="lazy" src="' + envSrc(i) + '" alt="店内环境"></figure>';
    }).join("");
    $("locGallery").innerHTML = envImgs.map(function (_, i) {
      return '<figure><img loading="lazy" src="' + envSrc(i) + '" alt="店内环境"></figure>';
    }).join("");
    var rooms = store.get("sl_tables", []).concat(D.store.rooms || []);
    var seenR = {};
    $("roomList").innerHTML = rooms.filter(function (r) { return r && !seenR[r] && (seenR[r] = 1); })
      .map(function (r) { return '<option value="' + r + '">'; }).join("");

    state.gallery = [];
  }

  /* ---------- 路由 ---------- */
  function go(view) {
    if (currentView() === view) { renderView(); return; }
    window.location.hash = "#/" + view;
    setTimeout(renderView, 0);
  }
  function currentView() {
    var h = window.location.hash.replace(/^#\/?/, "").split("?")[0];
    return h || "home";
  }
  function renderView() {
    var v = currentView();
    if (v === "staff" && state.mode !== "staff") v = "home";
    state.view = v;
    document.querySelectorAll(".view").forEach(function (s) {
      s.classList.toggle("on", s.id === "view-" + v);
    });
    document.querySelectorAll("#mainNav a").forEach(function (a) {
      a.classList.toggle("on", a.dataset.view === v);
    });
    var bh = $("backHome");
    if (bh) bh.hidden = v === "home";
    syncBrand();
    if (v === "menu") { renderFilters(); renderDishes(); }
    if (v === "staff") { renderAdmin(); updateResvBadge(); }
    if (v === "reserve") renderReserve();
    if (v === "home" || v === "visit" || v === "location") observeReveals();
    window.scrollTo(0, 0);
  }

  /* ---------- 点单页 ---------- */
  var BANDS = [
    ["all", "全部价位"], ["b0", "¥50以下"], ["b1", "¥50-100"], ["b2", "¥100-200"], ["b3", "¥200以上"]
  ];
  function inBand(p, band) {
    if (band === "all") return true;
    if (p === null) return false;
    if (band === "b0") return p < 50;
    if (band === "b1") return p >= 50 && p < 100;
    if (band === "b2") return p >= 100 && p < 200;
    return p >= 200;
  }

  function renderFilters() {
    $("priceBands").innerHTML = BANDS.map(function (b) {
      return '<button data-band="' + b[0] + '"' + (state.band === b[0] ? ' class="on"' : "") + ">" + b[1] + "</button>";
    }).join("");
    var cats = [{ id: "all", name: "全部" }].concat(catsOfGroup(state.group));
    $("catChips").innerHTML = cats.map(function (c) {
      return '<button data-cat="' + c.id + '"' + (state.cat === c.id ? ' class="on"' : "") + ">" + c.name + "</button>";
    }).join("");
  }

  /* 菜品媒体:自定义图/视频 > 菜单裁切图 > 装饰占位 */
  function hueOf(id) { var s = 0; for (var i = 0; i < id.length; i++) s = (s * 31 + id.charCodeAt(i)) % 360; return s; }
  function smallImg(src) {
    if (src && src.indexOf("assets/dishes/") === 0) return src.replace("assets/dishes/", "assets/dishes/th/");
    return src;
  }
  function mediaOf(d) {
    var custom = state.dishImg[d.id] || null;
    var imgs = custom ? [custom] : (d.imgs && d.imgs.length ? d.imgs : (d.img ? [d.img] : []));
    return {
      img: imgs[0] || null,
      imgs: imgs,
      video: state.dishVideo[d.id] || d.video || null
    };
  }

  /* 通行点单版式:招牌横滑卡 + 统一横向菜品行 + 分类侧栏 */
  function specList(d) {
    if (d.specs && d.specs.length > 1) return d.specs;
    return [{ unit: d.unit, price: d.price }];
  }
  function cartKey(d, unit) { return d.id + "@" + (unit || ""); }
  function addToCart(d, unit) {
    var k = cartKey(d, unit);
    state.cart[k] = (state.cart[k] || 0) + 1;
    saveCart(); renderCartBar(); refreshRow(d);
  }
  function decCart(d, unit) {
    var k = cartKey(d, unit);
    if (!state.cart[k]) return;
    state.cart[k]--;
    if (state.cart[k] <= 0) delete state.cart[k];
    saveCart(); renderCartBar(); refreshRow(d);
    if (!$("cartDrawer").hidden) renderCartDrawer();
  }
  function inGroup(d) {
    return catsOfGroup(state.group).some(function (c) { return c.id === d.category; });
  }
  function specQty(d, unit) { return state.cart[cartKey(d, unit)] || 0; }
  function dishQty(d) {
    return specList(d).reduce(function (t, sp) { return t + specQty(d, sp.unit); }, 0);
  }
  function stepperHtml(d) {
    var soldout = state.soldout[d.id];
    var specs = specList(d);
    if (specs.length > 1) {
      return specs.map(function (sp) {
        var q = specQty(d, sp.unit);
        return '<span class="stepper"><i class="u">' + sp.unit + '</i>' +
          (q > 0 ? '<button data-keydec="' + cartKey(d, sp.unit) + '">−</button><b>' + q + '</b>' : "") +
          '<button aria-label="加一份' + sp.unit + '" data-keyinc="' + cartKey(d, sp.unit) + '" title="' + sp.unit + ' ¥' + sp.price + '"' + (soldout ? " disabled" : "") + ">+</button></span>";
      }).join("");
    }
    var q = dishQty(d);
    if (q > 0) {
      return '<span class="stepper"><button data-keydec="' + cartKey(d, d.unit) + '">−</button><b>' + q + '</b>' +
        '<button data-keyinc="' + cartKey(d, d.unit) + '"' + (soldout ? " disabled" : "") + ">+</button></span>";
    }
    return addButtons(d, soldout);
  }
  function refreshRow(d) {
    var row = document.querySelector('.mline[data-id="' + d.id + '"] .madds');
    if (row) row.innerHTML = stepperHtml(d);
  }
  function addButtons(d, soldout) {
    var specs = specList(d);
    if (specs.length > 1) {
      return '<div class="spec-adds">' + specs.map(function (s) {
        return '<button data-addkey="' + cartKey(d, s.unit) + '"' + (soldout ? " disabled" : "") + ">" + s.unit + " ¥" + s.price + "</button>";
      }).join("") + "</div>";
    }
    return '<button class="qty-add" aria-label="加一份" data-addkey="' + cartKey(d, d.unit) + '"' + (soldout ? " disabled" : "") + ">+</button>";
  }
  function priceHtml(d) {
    var specs = specList(d);
    if (specs.length > 1) return specs.map(function (s) { return "<b>" + s.unit + "</b>¥" + s.price; }).join('<i class="sep">/</i>');
    return d.priceText + (d.unit ? " <small>/ " + d.unit + "</small>" : "");
  }
  function rowMedia(d, cls) {
    var m = mediaOf(d);
    var inner = m.img
      ? '<img loading="lazy" src="' + m.img + '" alt="' + d.name + '">'
      : '<div class="thumb-ph" style="--h:' + hueOf(d.id) + '">' + d.name.charAt(0) + "</div>";
    var play = m.video ? '<span class="play-badge">▶</span>' : "";
    var multi = m.imgs.length > 1 ? '<span class="multi-badge">' + m.imgs.length + '图</span>' : "";
    return '<div class="' + cls + '" data-thumb="' + d.id + '">' + inner + play + multi + "</div>";
  }
  function badgesHtml(d, compact) {
    var b = d.badges.slice(0, compact ? 1 : 3).map(function (x) { return '<span class="badge ' + x + '">' + x + "</span>"; }).join("");
    if (d.preorder) b += '<span class="badge 需预定">需预定</span>';
    return b ? '<div class="badges">' + b + "</div>" : "";
  }
  function featCard(d) {
    var soldout = state.soldout[d.id];
    return '<div class="feat-card' + (soldout ? " soldout" : "") + '" data-id="' + d.id + '">' +
      rowMedia(d, "feat-media") +
      '<div class="feat-info"><div class="dish-name">' + d.name + "</div>" +
      '<div class="dish-foot"><span class="dish-price">' + priceHtml(d) + "</span>" + addButtons(d, soldout) + "</div></div></div>";
  }
  function dishRow(d) {
    var soldout = state.soldout[d.id];
    var mark = d.uncertain && state.mode === "staff" ? ' <span class="uncertain-mark" title="转录待与门店核对">?</span>' : "";
    var orig = d.imgPage
      ? ' <a class="orig-page" data-openpage="' + d.imgPage + '" title="查看原版菜单页">原版 p' + String(d.imgPage).padStart(2, "0") + "</a>" : "";
    return '<div class="dish-row' + (soldout ? " soldout" : "") + '" data-id="' + d.id + '">' +
      rowMedia(d, "row-thumb") +
      '<div class="dish-body">' +
      '<div class="dish-name">' + d.name + mark + orig + "</div>" +
      badgesHtml(d, false) +
      (d.ingredients ? '<div class="dish-ing">' + d.ingredients + "</div>" : "") +
      '<div class="dish-foot"><span class="dish-price">' + priceHtml(d) + "</span>" + addButtons(d, soldout) + "</div>" +
      "</div></div>";
  }
  function featCandidates() {
    var pinned = store.get("sl_featured", []).map(dishById).filter(Boolean);
    if (pinned.length) return pinned.slice(0, 3);
    var pool = DISHES.filter(function (d) { return inGroup(d) && inBand(d.price, state.band); });
    var feats = pool.filter(function (d) { return d.badges.indexOf("招牌") >= 0; });
    if (feats.length < 3) {
      var extra = pool.filter(function (d) { return d.badges.indexOf("招牌") < 0 && d.price !== null; })
        .sort(function (a, b) { return b.price - a.price; }).slice(0, 4 - feats.length);
      feats = feats.concat(extra);
    }
    return feats.slice(0, 8);
  }
  function renderRail() {
    if (!$("catRail")) return;
    var cats = catsOfGroup(state.group);
    $("catRail").innerHTML = cats.map(function (c) {
      var n = DISHES.filter(function (d) { return d.category === c.id && inBand(d.price, state.band); }).length;
      return '<a class="rail-item' + (state.cat === c.id ? " on" : "") + '" data-rail="' + c.id + '"><span>' + c.name +
        "</span><i>" + n + "</i></a>";
    }).join("");
  }
  function syncRail() {
    var y = window.pageYOffset || 0, cur = null;
    document.querySelectorAll(".cat-section").forEach(function (s) {
      if (s.offsetTop - 170 <= y) cur = s.dataset.cat;
    });
    if (!cur) return;
    $("catRail").querySelectorAll(".rail-item").forEach(function (a) {
      a.classList.toggle("on", a.dataset.rail === cur);
    });
  }

  function menuLine(d) {
    var m = mediaOf(d);
    var soldout = state.soldout[d.id];
    var inner = m.img ? '<img class="lazy-thumb" loading="lazy" src="' + smallImg(m.img) + '" data-full="' + m.img + '" alt="' + d.name + '">'
      : '<div class="thumb-ph" style="--h:' + hueOf(d.id) + '">' + d.name.charAt(0) + "</div>";
    var mark = d.uncertain && state.mode === "staff" ? ' <span class="uncertain-mark">?</span>' : "";
    var orig = "";
    var nm = esc(d.name);
    var ing = esc(d.ingredients || "");
    return '<div class="mline' + (soldout ? " soldout" : "") + '" data-id="' + d.id + '">' +
      '<div class="mthumb" data-thumb="' + d.id + '">' + inner + (m.video ? '<span class="play-badge">▶</span>' : "") + "</div>" +
      '<div class="mmain">' +
      '<div class="mrow1"><span class="mname" title="' + nm + '">' + nm + mark + " " + orig + '</span><span class="dots"></span>' +
      '<span class="mprice">' + priceHtml(d) + "</span></div>" +
      '<div class="mrow2">' + badgesHtml(d, true) + (ing ? '<span class="ming">' + ing + "</span>" : "") +
      '<span class="madds">' + stepperHtml(d) + "</span></div>" +
      "</div></div>";
  }
  function syncBrand() {
    var bf = $("brandFix");
    if (!bf) return;
    var hero = document.querySelector(".hero");
    var th = hero ? Math.max(120, hero.offsetHeight - 100) : 120;
    var y = window.pageYOffset || 0;
    var show = state.view !== "home" || y > th;
    bf.classList.toggle("show", show);
  }

  function observeReveals() {
    var els = document.querySelectorAll(".rv:not(.in)");
    if (typeof IntersectionObserver === "undefined") {
      els.forEach(function (el) { el.classList.add("in"); }); return;
    }
    if (!state._io) {
      state._io = new IntersectionObserver(function (entries) {
        entries.forEach(function (en) { if (en.isIntersecting) { en.target.classList.add("in"); state._io.unobserve(en.target); } });
      }, { threshold: 0.12 });
    }
    els.forEach(function (el) { state._io.observe(el); });
  }

  function buildMenuDoc() {
    var groups = [["menu", "电子菜单"], ["drinks", "酒水单"]];
    return groups.map(function (g) {
      var cats = CATS.filter(function (c) { return c.group === g[0]; });
      var secs = cats.map(function (c) {
        var lines = DISHES.filter(function (d) { return d.category === c.id; }).map(function (d) {
          return d.name + (d.unit ? "（" + d.unit + "）" : "") + "　" + d.priceText;
        }).join("\n");
        return "◆ " + c.name + "\n" + lines;
      }).join("\n\n");
      return "【" + g[1] + "】\n\n" + secs;
    }).join("\n\n") + "\n\n—— 菜单信息如有变动，以门店当日公示为准 ——";
  }

  function renderDishes() {
    var cats = state.cat === "all" ? catsOfGroup(state.group) : CATS.filter(function (c) { return c.id === state.cat; });
    var htmls = [], preorderShown = false, n = 0;
    cats.forEach(function (c) {
      var q = state.search.trim();
      var list = DISHES.filter(function (d) {
        return d.category === c.id && inBand(d.price, state.band) &&
          (!q || d.name.indexOf(q) >= 0 || (d.ingredients || "").indexOf(q) >= 0);
      });
      if (!list.length) return;
      if (c.name === "预定菜品") preorderShown = true;
      n += 1;
      htmls.push('<div class="mcat rv" id="sec-' + c.id + '" data-cat="' + c.id + '">' +
        '<div class="mcat-head"><i>' + String(n).padStart(2, "0") + "</i><h3>" + c.name + '</h3><span class="cat-count">' + list.length + "</span></div>" +
        '<div class="mlines">' + list.map(menuLine).join("") + "</div></div>");
    });
    var docHtml = '<div class="menu-doc"><button class="md-toggle" id="menuDocToggle">原版菜单 · 文档版 ▾</button>' +
      '<div class="md-body" id="menuDocBody" hidden>' + buildMenuDoc() + "</div></div>";
    $("dishGrid").innerHTML = (htmls.join("") || '<p class="cap">该筛选下没有菜品。</p>') + docHtml;
    $("preorderTip").hidden = !(state.group === "menu" && preorderShown);
    renderRail();
    observeReveals();
    var mdt = $("menuDocToggle");
    if (mdt && !mdt._bound) {
      mdt._bound = true;
      mdt.addEventListener("click", function () {
        var b = $("menuDocBody");
        b.hidden = !b.hidden;
        this.textContent = "原版菜单 · 文档版 " + (b.hidden ? "▾" : "▴");
      });
    }
  }

  /* ---------- 购物车 ---------- */
  function cartEntries() {
    return Object.keys(state.cart).map(function (key) {
      var at = key.lastIndexOf("@");
      var id = key.slice(0, at), unit = key.slice(at + 1);
      var d = dishById(id);
      if (!d || state.cart[key] <= 0) return null;
      var sp = (d.specs || []).filter(function (s) { return s.unit === unit; })[0] || { unit: unit, price: d.price };
      return { d: d, qty: state.cart[key], unit: unit, price: sp.price };
    }).filter(Boolean);
  }
  function cartTotal() {
    return cartEntries().reduce(function (s, e) { return s + (e.price || 0) * e.qty; }, 0);
  }
  function renderCartBar() {
    var es = cartEntries(), n = es.reduce(function (s, e) { return s + e.qty; }, 0);
    $("cartBar").hidden = n === 0 || !$("cartDrawer").hidden;
    $("tableChip").textContent = state.table ? "桌号 " + state.table : "选桌号";
    if (n > 0) $("cartSummary").textContent = "已选 " + n + " 件 · ¥" + cartTotal() + "起";
  }
  function renderCartDrawer() {
    var es = cartEntries();
    $("cartItems").innerHTML = es.map(function (e) {
      return '<div class="cart-item"><span class="n">' + e.d.name + "（" + e.unit + "）</span>" +
        '<button data-dec="' + e.d.id + "@" + e.unit + '">−</button><span>' + e.qty + "</span>" +
        '<button data-inc="' + e.d.id + "@" + e.unit + '">+</button>' +
        '<span class="p">' + (e.price === null ? "时价" : "¥" + e.price) + "×" + e.qty + "</span></div>";
    }).join("") || '<p class="media-caption">还没有选菜。</p>';
    $("staffFields").hidden = state.mode !== "staff";
    $("orderSaveStaff").hidden = state.mode !== "staff";
    $("orderSubmit").hidden = state.mode === "staff";
    $("payPick").hidden = state.mode === "staff";
    if (state.mode === "staff" && state.table && !$("odRoom").value) $("odRoom").value = state.table;
    renderCartBar();
  }

  function orderText(extra) {
    var es = cartEntries();
    var lines = ["【私厦里·新闽南 大悦城店】" + (extra && extra.title ? extra.title : "线上点单")];
    if (state.table) lines.push("桌号/包厢：" + state.table);
    if (extra && extra.head) lines = lines.concat(extra.head);
    lines.push("――――――――――");
    es.forEach(function (e, i) {
      lines.push((i + 1) + ". " + e.d.name + " ×" + e.qty + "（" + e.unit + "）" + (e.price === null ? "时价" : "¥" + e.price * e.qty));
    });
    lines.push("――――――――――");
    lines.push("合计：¥" + cartTotal() + (es.some(function (e) { return e.d.price === null; }) ? "（含时价菜，以门店当日价为准）" : ""));
    var note = $("cartNote").value.trim();
    if (note) lines.push("备注：" + note);
    return lines.join("\n");
  }

  function copyText(text, btn) {
    var done = function () {
      if (btn) { var t = btn.textContent; btn.textContent = "已复制"; setTimeout(function () { btn.textContent = t; }, 1500); }
    };
    if (navigator.clipboard && navigator.clipboard.writeText) {
      navigator.clipboard.writeText(text).then(done, function () { fallbackCopy(text); done(); });
    } else { fallbackCopy(text); done(); }
  }
  function fallbackCopy(text) {
    var ta = document.createElement("textarea");
    ta.value = text; document.body.appendChild(ta); ta.select();
    try { document.execCommand("copy"); } catch (e) {}
    document.body.removeChild(ta);
  }

  /* ---------- 店家端 ---------- */
  function renderOrders() {
    var orders = store.get(todayKey(), []);
    var el = $("todayOrders");
    if (!orders.length) { el.innerHTML = '<p class="media-caption">今日暂无线下订单。</p>'; return; }
    var total = 0, html = "";
    orders.slice().reverse().forEach(function (o, ri) {
      var idx = orders.length - 1 - ri;
      total += o.total;
      html += '<div class="order-item"><button class="del" data-delorder="' + idx + '">删除</button>' +
        "<b>" + o.room + "</b> · " + o.session + " · " + o.party + "位 · " + o.time +
        '<div class="meta">' + o.items.map(function (it) { return it.name + "×" + it.qty; }).join("、") + " · ¥" + o.total + "</div></div>";
    });
    html += '<div class="orders-total">今日 ' + orders.length + " 单 · 合计 ¥" + total + "（时价菜按 0 计）</div>";
    el.innerHTML = html;
  }

  function renderSoldout(filter) {
    var f = (filter || "").trim();
    var list = DISHES.filter(function (d) { return !f || d.name.indexOf(f) >= 0; }).slice(0, 80);
    $("soldoutList").innerHTML = list.map(function (d) {
      return '<div class="soldout-row"><span>' + d.name + '</span><button class="sw' + (state.soldout[d.id] ? " on" : "") + '" data-soldout="' + d.id + '" title="点击切换售罄/上架"></button></div>';
    }).join("");
  }

  /* ---------- 预约生成器 ---------- */
  function renderReserve() {
    var g = $("rvGuest").value.trim() || "贵宾";
    var d = $("rvDate").value || "";
    var lines = [
      "【私厦里·新闽南 大悦城店】",
      "尊敬的 " + g + " 贵宾 私厦里为您预留信息如下：",
      "【预定日期】：" + (d || "＿月＿日"),
      "【预定餐段】：" + $("rvSession").value,
      "【预定时间】：" + ($("rvTime").value || "18:30"),
      "【预定包厢】：" + ($("rvRoom").value || "秋分包厢"),
      "【用餐人数】：" + ($("rvParty").value || "＿") + "位",
      "【餐厅电话】：" + primaryPhone(),
      "【餐厅地址】：" + D.store.address,
      "",
      "【温馨提醒】：",
      "若您有忌口、过敏食材或预订调整请提前告知；",
      "若您有任何意见请当面告知，我们会给您满意的答复。",
      "私厦里全体员工恭候您的光临，祝您生活愉快！"
    ];
    $("rvOutput").value = lines.join("\n");
  }

  /* ---------- 桌号选择 ---------- */
  function ensureTable(allowSkip, cb) {
    var tables = store.get("sl_tables", []);
    var sel = null;
    $("tableInputRow").hidden = tables.length > 0;
    $("tableInput").value = "";
    $("tableGrid").innerHTML = tables.map(function (t) {
      return "<button data-table=\"" + t + "\">" + t + "</button>";
    }).join("") + '<button data-table="__manual__">手动输入</button>';
    $("tableGrid").querySelectorAll("button").forEach(function (b) {
      b.addEventListener("click", function () {
        $("tableGrid").querySelectorAll("button").forEach(function (x) { x.classList.remove("on"); });
        b.classList.add("on");
        if (b.dataset.table === "__manual__") {
          sel = "__manual__";
          $("tableInputRow").hidden = false;
          $("tableInput").focus();
        } else { sel = b.dataset.table; }
      });
    });
    $("tableSkip").hidden = !allowSkip;
    $("tableModal").hidden = false;
    $("tableOk").onclick = function () {
      var val = (sel && sel !== "__manual__") ? sel : $("tableInput").value.trim();
      if (val) state.table = val;
      $("tableModal").hidden = true;
      renderCartBar();
      if (cb) cb();
    };
    $("tableSkip").onclick = function () {
      $("tableModal").hidden = true;
      if (cb) cb();
    };
  }

  /* ---------- 店家验证 ---------- */
  function adminPass() { return store.get("sl_admin_pass", "666888"); }
  function askPass() {
    $("passInput").value = "";
    $("passError").hidden = true;
    $("passModal").hidden = false;
    $("passInput").focus();
  }
  function tryPass() {
    if ($("passInput").value.trim() === adminPass()) {
      state.unlocked = true;
      $("passModal").hidden = true;
      state.mode = "staff"; store.set("sl_mode", state.mode);
      applyMode();
      go("staff");
    } else {
      $("passError").hidden = false;
      $("passInput").value = "";
      $("passInput").focus();
    }
  }

  /* ---------- 菜品/桌号管理 ---------- */
  function renderAdmin() {
    var opts = "";
    ["menu", "drinks"].forEach(function (g) {
      opts += '<optgroup label="' + (g === "menu" ? "菜品" : "酒水") + '">' +
        catsOfGroup(g).map(function (c) { return '<option value="' + c.id + '">' + c.name + "</option>"; }).join("") +
        "</optgroup>";
    });
    $("ndCat").innerHTML = opts;

    var orders = store.get(todayKey(), []);
    var resv = reservations();
    var soldCount = Object.keys(state.soldout).length;
    var co = custOrders();
    $("stOrders").textContent = orders.length + co.length;
    $("stRevenue").textContent = "¥" + orders.reduce(function (t, o) { return t + o.total; }, 0);
    $("stResv").textContent = resv.filter(function (r) { return r.status === "new"; }).length;
    $("stDishes").textContent = (DISHES.length - soldCount) + " / " + soldCount;
    renderOrders();
    renderCustOrders();
    renderReservations();
    renderSiteForms();
    renderSiteImgGrid();
    renderSoldout($("soldoutSearch").value);

    var custom = store.get("sl_custom", []);
    $("customList").innerHTML = custom.map(function (d) {
      return '<div class="mgmt-row"><span>' + d.name + ' <span class="tag">' + d.priceText + " / " + (d.unit || "") + "</span></span>" +
        '<span class="ops"><button data-imgfor="' + d.id + '">图片</button>' +
        '<button data-videofor="' + d.id + '">视频</button>' +
        '<button data-delcustom="' + d.id + '" class="warn">删除</button></span></div>';
    }).join("") || '<p class="cap">还没有自定义菜品，用左侧表单上新。</p>';
    renderHideList($("hideSearch").value);
    $("tablesInput").value = store.get("sl_tables", []).join("，");
  }
  function renderSiteForms() {
    $("svBrand").value = state.site.brand || "";
    $("svBranch").value = state.site.branch || "";
    $("svEn").value = state.site.en || "";
    $("svSlogan").value = state.site.slogan || "";
    $("svAddr").value = state.site.addr || "";
    $("svAccess").value = state.site.access || "";
    $("svPhone").value = state.site.phone || "";
    $("svNotice").value = state.site.notice || "";
    $("svHours").value = state.site.hours || "";
    $("svWifi").value = state.site.wifi || "";
    $("svManifesto").value = state.site.manifesto || "";
    renderFeat();
  }
  function renderFeat() {
    var pinned = store.get("sl_featured", []);
    $("featPicks").innerHTML = pinned.map(function (id) {
      var d = dishById(id);
      return d ? '<span class="feat-pick">' + d.name + "<b data-featdel=\"" + id + "\" title=\"移除\">✕</b></span>" : "";
    }).join("") || '<span class="cap">未设置，当前自动推荐。</span>';
    var f = ($("featSearch").value || "").trim();
    var list = DISHES.filter(function (d) { return !f || d.name.indexOf(f) >= 0; }).slice(0, 8);
    $("featResults").innerHTML = list.map(function (d) {
      var on = pinned.indexOf(d.id) >= 0;
      return '<div class="mgmt-row"><span>' + d.name + ' <span class="tag">' + d.priceText + "</span></span>" +
        '<span class="ops"><button data-featadd="' + d.id + '"' + (on ? ' class="on"' : "") + '>' + (on ? "已精选" : "设为精选") + "</button></span></div>";
    }).join("");
  }
  function renderSiteImgGrid() {
    var ex = D.store.extras || {};
    var defs = (ex.envImages || []).concat(ex.recommendImages || []);
    $("siteImgGrid").innerHTML = ["环境图1", "环境图2", "环境图3", "菜品图1", "菜品图2", "菜品图3"].map(function (name, i) {
      var key = (i < 3 ? "env" : "rec") + (i % 3 + 1);
      var src = state.siteImg[key] || defs[i];
      return '<div class="slot" data-siteslot="' + key + '"><img loading="lazy" src="' + src + '"><span class="cap">' + name + "</span></div>";
    }).join("");
  }

  function renderHideList(filter) {
    var f = (filter || "").trim();
    var hidden = store.get("sl_hidden", {});
    var list = D.dishes.filter(function (d) { return !f || d.name.indexOf(f) >= 0; }).slice(0, 80);
    $("hideList").innerHTML = list.map(function (d) {
      var h = hidden[d.id];
      return '<div class="mgmt-row"><span>' + d.name + (h ? ' <span class="tag">已隐藏</span>' : "") + "</span>" +
        '<span class="ops"><button data-imgfor="' + d.id + '">图片</button>' +
        '<button data-hide="' + d.id + '"' + (h ? ' class="on"' : "") + '>' + (h ? "恢复" : "隐藏") + "</button></span></div>";
    }).join("");
  }

  /* ---------- 预约流程 ---------- */
  function reservations() { return store.get("sl_reservations", []); }
  function saveReservations(list) { store.set("sl_reservations", list); updateResvBadge(); }
  function updateResvBadge() {
    var n = reservations().filter(function (r) { return r.status === "new"; }).length;
    var b = $("resvBadge");
    if (!b) return;
    b.hidden = n === 0;
    b.textContent = n;
  }
  function renderReservations() {
    var f = $("resvFilter") && $("resvFilter").value;
    var list = reservations().filter(function (r) { return !f || r.date === f; })
      .sort(function (a, b) { return b.createdAt > a.createdAt ? 1 : -1; });
    var el = $("resvList");
    el.innerHTML = list.map(function (r) {
      var stMap = { new: ["new", "新预约"], ok: ["ok", "已确认"], cancel: ["cancel", "已取消"] };
      var st = stMap[r.status] || stMap.new;
      return '<div class="resv-item">' +
        '<div class="when"><b>' + r.date.slice(5) + " " + r.time + "</b><span>" + r.session + " · " + r.room + "</span></div>" +
        '<div class="who"><b>' + r.guest + "</b> " + r.party + '位<span class="resv-st ' + st[0] + '">' + st[1] + "</span>" +
        '<div class="meta">' + (r.phone || "未留电话") + (r.note ? " · " + r.note : "") + " · 提交于 " + r.createdText + "</div></div>" +
        '<div class="ops">' +
        (r.phone ? '<a class="tbtn" href="tel:' + r.phone + '">回电</a>' : "") +
        (r.status === "new" ? '<button class="tbtn solid" data-resv-ok="' + r.id + '">确认</button>' : "") +
        (r.status !== "cancel" ? '<button class="tbtn ghost" data-resv-cancel="' + r.id + '">取消</button>' : "") +
        "</div></div>";
    }).join("") || '<p class="cap">暂无预约。</p>';
  }

  /* ---------- 支付与线上订单 ---------- */
  function payCfg() { return store.get("sl_pay", {}); }
  function renderPayPick() {
    var cfg = payCfg();
    var opts = [{ k: "到店支付", need: true }, { k: "微信支付", need: cfg.wxImg }, { k: "支付宝", need: cfg.aliImg }];
    if (!state.payMethod) state.payMethod = "到店支付";
    if (state.payMethod !== "到店支付" && !cfg[state.payMethod === "微信支付" ? "wxImg" : "aliImg"]) state.payMethod = "到店支付";
    $("payPick").innerHTML = "<p>支付方式</p>" + opts.filter(function (o) { return o.need; }).map(function (o) {
      return '<label class="pay-opt"><input type="radio" name="paym" value="' + o.k + '"' +
        (state.payMethod === o.k ? " checked" : "") + ">" + o.k + (o.k !== "到店支付" ? "(扫码)" : "") + "</label>";
    }).join("");
    $("payPick").querySelectorAll("input").forEach(function (r) {
      r.addEventListener("change", function () { state.payMethod = this.value; });
    });
    $("payPick").hidden = state.mode === "staff";
  }
  function custOrders() { return store.get("sl_cust_orders", []); }
  function saveCustOrders(l) { store.set("sl_cust_orders", l); renderCustOrders(); }
  function renderCustOrders() {
    var el = $("custOrders");
    if (!el) return;
    var list = custOrders().slice().reverse();
    if (!list.length) { el.innerHTML = '<p class="cap">暂无线上订单。</p>'; return; }
    var stMap = { new: ["new", "待接单"], ok: ["ok", "已接单"], done: ["done", "已完成"] };
    el.innerHTML = list.map(function (o) {
      var st = stMap[o.status] || stMap.new;
      return '<div class="cust-order"><div class="head"><span class="no">No.' + o.no + "</span>" +
        "<b>" + o.table + "</b><span>" + o.time + "</span>" +
        '<span class="resv-st ' + st[0] + '">' + st[1] + "</span>" +
        (o.payMethod ? '<span class="resv-st ' + (o.payClaimed ? "ok" : "cancel") + '">' + o.payMethod + (o.payClaimed ? "·已付" : "·待付") + "</span>" : "") +
        '<span style="margin-left:auto">¥' + o.total + "</span></div>" +
        '<div class="items">' + o.items.map(function (it) { return it.name + "×" + it.qty + "(" + it.unit + ")"; }).join("、") +
        (o.note ? " · " + o.note : "") + "</div>" +
        '<div class="ops">' +
        (o.status === "new" ? '<button class="tbtn" data-custok="' + o.id + '">接单</button>' : "") +
        (o.status !== "done" ? '<button class="tbtn ghost" data-custdone="' + o.id + '">完成</button>' : "") +
        "</div></div>";
    }).join("");
  }

  /* ---------- 事件 ---------- */
  function bind() {
    $("groupTabs").addEventListener("click", function (e) {
      var b = e.target.closest("button"); if (!b) return;
      state.group = b.dataset.group; state.cat = "all";
      $("groupTabs").querySelectorAll("button").forEach(function (x) { x.classList.toggle("on", x === b); });
      renderFilters(); renderDishes();
    });
    $("priceBands").addEventListener("click", function (e) {
      var b = e.target.closest("button"); if (!b) return;
      state.band = b.dataset.band; renderFilters(); renderDishes();
    });
    $("catChips").addEventListener("click", function (e) {
      var b = e.target.closest("button"); if (!b) return;
      state.cat = b.dataset.cat; renderFilters(); renderDishes();
    });
    document.addEventListener("click", function (e) {
      var thumb = e.target.closest("[data-thumb]");
      if (thumb) {
        var d = dishById(thumb.dataset.thumb);
        if (!d) return;
        var m = mediaOf(d);
        if (m.video) {
          $("dishVideoPlayer").src = m.video;
          $("videoModal").hidden = false;
          $("dishVideoPlayer").play().catch(function () {});
        } else if (m.imgs.length) {
          state.viewerSingle = m.imgs.length === 1;
          state.gallery = m.imgs;
          state.viewerIdx = 0;
          $("viewerImg").src = m.imgs[0];
          syncViewerCount();
          $("viewer").hidden = false;
        }
        return;
      }
      var si = e.target.closest("[data-keyinc]"), sd = e.target.closest("[data-keydec]");
      if (si || sd) {
        var key2 = (si || sd).dataset.keyinc || (si || sd).dataset.keydec;
        var at2 = key2.lastIndexOf("@");
        var dd = dishById(key2.slice(0, at2));
        if (!dd) return;
        if (si) addToCart(dd, key2.slice(at2 + 1));
        else decCart(dd, key2.slice(at2 + 1));
        return;
      }
      var b = e.target.closest("[data-addkey]"); if (!b || b.disabled) return;
      var key = b.dataset.addkey;
      var at = key.lastIndexOf("@");
      var d = dishById(key.slice(0, at));
      if (!d) return;
      var unit = key.slice(at + 1);
      var doAdd = function () { addToCart(d, unit); };
      if (!state.table) { ensureTable(false, doAdd); } else { doAdd(); }
    });
    $("cartBar").addEventListener("click", function () {
      $("cartDrawer").hidden = false; $("drawerMask").hidden = false;
      document.body.style.overflow = "hidden";
      renderCartDrawer(); renderPayPick();
    });
    $("drawerMask").addEventListener("click", closeDrawer);
    function closeDrawer() {
      $("cartDrawer").hidden = true; $("drawerMask").hidden = true;
      document.body.style.overflow = ""; renderCartBar();
    }
    $("cartDrawer").addEventListener("click", function (e) {
      var inc = e.target.closest("[data-inc]"), dec = e.target.closest("[data-dec]");
      if (inc) state.cart[inc.dataset.inc]++;
      if (dec) { state.cart[dec.dataset.dec]--; if (state.cart[dec.dataset.dec] <= 0) delete state.cart[dec.dataset.dec]; }
      if (inc || dec) { saveCart(); renderCartDrawer(); }
    });
    $("cartClear").addEventListener("click", function () { state.cart = {}; saveCart(); closeDrawer(); });
    $("orderSubmit").addEventListener("click", function () {
      var es = cartEntries();
      if (!es.length) return;
      if (state._submitting) return;
      state._submitting = true;
      var subBtn = this; subBtn.disabled = true;
      var seq = store.get("sl_order_seq", 100) + 1;
      store.set("sl_order_seq", seq);
      var now = new Date();
      var o = {
        id: "c" + Date.now(),
        store: D.meta.storeId || "huanxi-dayue",
        no: String(seq),
        time: String(now.getHours()).padStart(2, "0") + ":" + String(now.getMinutes()).padStart(2, "0"),
        date: new Date().toISOString().slice(0, 10),
        table: state.table || "未选桌号",
        items: es.map(function (e) { return { name: e.d.name, qty: e.qty, unit: e.unit, price: e.price }; }),
        total: cartTotal(),
        note: $("cartNote").value.trim(),
        payMethod: state.mode === "staff" ? "" : (state.payMethod || "到店支付"),
        payClaimed: false,
        status: "new"
      };
      var list = custOrders(); list.push(o); saveCustOrders(list);
      var cfg = payCfg();
      var needQr = o.payMethod === "微信支付" || o.payMethod === "支付宝";
      var text = orderText(null);
      $("orderSuccess").hidden = false;
      $("orderSuccess").innerHTML = "<b>下单成功 · 取餐号 " + o.no + "</b><br>店家已收到订单(" + o.table + " · ¥" + o.total + ")。" +
        '<div class="ops"><a class="tbtn" href="sms:' + primaryPhone() + "?body=" + encodeURIComponent("【私厦里】新订单 No." + o.no + "\n" + text) + '">短信同步店家</a>' +
        (needQr ? '<button class="tbtn solid" id="goPayQr">扫码支付(' + o.payMethod + ")</button>" : "") +
        '<button class="tbtn ghost" id="orderDoneBtn">完成</button></div>';
      state.lastOrderId = o.id;
      setTimeout(function () { state._submitting = false; subBtn.disabled = false; }, 1200);
      var gq = $("goPayQr");
      if (gq) gq.addEventListener("click", function () {
        $("payQrImg").src = cfg[o.payMethod === "微信支付" ? "wxImg" : "aliImg"];
        $("payModal").hidden = false;
      });
      $("orderDoneBtn").addEventListener("click", function () {
        state.cart = {}; saveCart();
        $("cartDrawer").hidden = true; $("drawerMask").hidden = true;
        $("orderSuccess").hidden = true;
        renderCartBar(); renderDishes();
      });
    });
    $("payDone").addEventListener("click", function () {
      var list = custOrders();
      list.forEach(function (o) { if (o.id === state.lastOrderId) o.payClaimed = true; });
      saveCustOrders(list);
      $("payModal").hidden = true;
    });
    $("payClose").addEventListener("click", function () { $("payModal").hidden = true; });
    $("custOrders").addEventListener("click", function (e) {
      var ok = e.target.closest("[data-custok]"), done = e.target.closest("[data-custdone]");
      var id = ok ? ok.dataset.custok : (done ? done.dataset.custdone : null);
      if (!id) return;
      var list = custOrders();
      list.forEach(function (o) { if (o.id === id) o.status = ok ? "ok" : "done"; });
      saveCustOrders(list); renderAdmin();
    });
    // 收款码上传
    var payTarget = null;
    function bindPaySlot(pick, clear, key) {
      $(pick).addEventListener("click", function () { payTarget = key; $("payImgFile").click(); });
      $(clear).addEventListener("click", function () {
        var cfg = payCfg(); delete cfg[key]; store.set("sl_pay", cfg);
      });
    }
    bindPaySlot("payWxPick", "payWxClear", "wxImg");
    bindPaySlot("payAliPick", "payAliClear", "aliImg");
    $("payImgFile").addEventListener("change", function () {
      var f = this.files && this.files[0]; this.value = "";
      if (!f || !payTarget) return;
      compressImage(f, function (data) {
        var cfg = payCfg(); cfg[payTarget] = data; store.set("sl_pay", cfg);
        var b = $(payTarget === "wxImg" ? "payWxPick" : "payAliPick");
        b.textContent = "已上传 ✓"; setTimeout(function () { b.textContent = "上传二维码"; }, 1500);
      });
    });
    $("cartOpen").addEventListener("click", function () {
      $("cartDrawer").hidden = false; $("drawerMask").hidden = false;
      $("orderSuccess").hidden = true;
      renderPayPick(); renderCartDrawer();
    });
    $("orderGen").addEventListener("click", function () {
      if (!cartEntries().length) return;
      var head = null;
      if (state.mode === "staff") {
        head = ["餐段：" + $("odSession").value + " ｜ 包厢/桌号：" + ($("odRoom").value || "—") + " ｜ 人数：" + ($("odParty").value || "—") + "位"];
      }
      var out = $("orderOutput");
      out.hidden = false;
      out.value = orderText(state.mode === "staff" ? { title: "线下下单（店家录入）", head: head } : null);
      $("orderCopy").hidden = false;
    });
    $("orderCopy").addEventListener("click", function () { copyText($("orderOutput").value, $("orderCopy")); });
    $("orderSaveStaff").addEventListener("click", function () {
      var es = cartEntries(); if (!es.length) return;
      var orders = store.get(todayKey(), []);
      var now = new Date();
      orders.push({
        time: String(now.getHours()).padStart(2, "0") + ":" + String(now.getMinutes()).padStart(2, "0"),
        room: $("odRoom").value || state.table || "未填",
        table: state.table,
        session: $("odSession").value,
        party: $("odParty").value || "?",
        items: es.map(function (e) { return { name: e.d.name, qty: e.qty, unit: e.unit, price: e.price }; }),
        total: cartTotal(),
        note: $("cartNote").value.trim()
      });
      store.set(todayKey(), orders);
      state.cart = {}; saveCart(); $("orderOutput").hidden = true; $("orderCopy").hidden = true;
      closeDrawer(); renderOrders();
    });
    $("staffEntry").addEventListener("click", function () {
      if (state.mode === "staff") {
        state.mode = "customer"; state.unlocked = false; store.set("sl_mode", "customer");
        applyMode(); go("home");
      } else askPass();
    });
    $("passOk").addEventListener("click", tryPass);
    $("passCancel").addEventListener("click", function () { $("passModal").hidden = true; });
    $("passInput").addEventListener("keydown", function (e) { if (e.key === "Enter") tryPass(); });
    $("tableChip").addEventListener("click", function () { ensureTable(true, renderCartBar); });

    $("admTabs").addEventListener("click", function (e) {
      var b = e.target.closest("[data-tab]"); if (!b) return;
      state.admTab = b.dataset.tab;
      document.querySelectorAll(".adm-tabs button").forEach(function (x) { x.classList.toggle("on", x === b); });
      document.querySelectorAll(".adm-tab").forEach(function (p) { p.hidden = p.id !== "tab-" + b.dataset.tab; });
      if (b.dataset.tab === "resv") renderReservations();
    });
    $("resvList").addEventListener("click", function (e) {
      var ok = e.target.closest("[data-resv-ok]"), cancel = e.target.closest("[data-resv-cancel]");
      var id = ok ? ok.dataset.resvOk : (cancel ? cancel.dataset.resvCancel : null);
      if (!id) return;
      var list = reservations();
      list.forEach(function (r) { if (r.id === id) r.status = ok ? "ok" : "cancel"; });
      saveReservations(list); renderReservations(); renderAdmin();
    });
    $("resvFilter").addEventListener("input", renderReservations);
    $("resvExport").addEventListener("click", function () {
      var blob = new Blob([JSON.stringify(reservations(), null, 2)], { type: "application/json" });
      var a = document.createElement("a");
      a.href = URL.createObjectURL(blob); a.download = "huanxi-reservations.json"; a.click();
      URL.revokeObjectURL(a.href);
    });
    $("splashEnter").addEventListener("click", function () {
      var hv = document.getElementById("heroBgVideo");
      hv && (hv.muted = true);
      tryHeroPlay(hv);
      wxUnlock();
      dismissSplash();
    });
    $("featSearch").addEventListener("input", renderFeat);
    $("featResults").addEventListener("click", function (e) {
      var b = e.target.closest("[data-featadd]"); if (!b) return;
      var id = b.dataset.featadd;
      var pinned = store.get("sl_featured", []).filter(function (x) { return x !== id; });
      if (pinned.length < 3) pinned.push(id); else { alert("最多精选 3 道，请先移除"); return; }
      store.set("sl_featured", pinned);
      renderFeat(); renderStatic();
    });
    $("featPicks").addEventListener("click", function (e) {
      var b = e.target.closest("[data-featdel]"); if (!b) return;
      store.set("sl_featured", store.get("sl_featured", []).filter(function (x) { return x !== b.dataset.featdel; }));
      renderFeat(); renderStatic();
    });
    $("svSave").addEventListener("click", function () {
      state.site = {
        brand: $("svBrand").value.trim(), branch: $("svBranch").value.trim(),
        en: $("svEn").value.trim(), slogan: $("svSlogan").value.trim(),
        addr: $("svAddr").value.trim(), access: $("svAccess").value.trim(),
        phone: $("svPhone").value.trim(), notice: $("svNotice").value.trim(),
        hours: $("svHours").value.trim(), wifi: $("svWifi").value.trim(),
        manifesto: $("svManifesto").value.trim()
      };
      store.set("sl_site", state.site);
      renderStatic(); renderView();
      var b = $("svSave"); b.textContent = "已保存"; setTimeout(function () { b.textContent = "保存站点信息"; }, 1500);
    });
    function bindVideoPick(pickId, fileId, key) {
      $(pickId).addEventListener("click", function () {
        if (!window.indexedDB) { alert("视频上传需通过 http 服务访问页面（双击 file:// 打开不支持），请用本地预览地址操作"); return; }
        $(fileId).click();
      });
      $(fileId).addEventListener("change", function () {
        var f = this.files && this.files[0]; this.value = "";
        if (!f) return;
        idbSet(key, f).then(loadSiteMedia).catch(function () { alert("保存失败"); });
      });
      $(pickId.replace("Pick", "Reset")).addEventListener("click", function () {
        idbSet(key, null).then(loadSiteMedia);
      });
    }
    bindVideoPick("svBrandPick", "svBrandFile", "brandVideo");
    bindVideoPick("svParkPick", "svParkFile", "parkingVideo");
    var siteSlotKey = null;
    $("siteImgGrid").addEventListener("click", function (e) {
      var sl = e.target.closest("[data-siteslot]"); if (!sl) return;
      siteSlotKey = sl.dataset.siteslot; $("siteImgFile").click();
    });
    $("siteImgFile").addEventListener("change", function () {
      var f = this.files && this.files[0]; this.value = "";
      if (!f || !siteSlotKey) return;
      compressImage(f, function (data) {
        state.siteImg[siteSlotKey] = data;
        store.set("sl_site_img", state.siteImg);
        renderSiteImgGrid(); renderStatic();
      });
    });
    $("rvSubmit").addEventListener("click", function () {
      var guest = $("rvGuest").value.trim();
      var date = $("rvDate").value;
      if (!guest || !date) { alert("请填写贵宾称呼与日期"); return; }
      var now = new Date();
      var r = {
        id: "r" + Date.now(),
        createdAt: new Date().toISOString(),
        createdText: String(now.getHours()).padStart(2, "0") + ":" + String(now.getMinutes()).padStart(2, "0"),
        guest: guest, phone: $("rvPhone").value.trim(), date: date,
        session: $("rvSession").value, time: $("rvTime").value || "18:30",
        room: $("rvRoom").value || "V10-欢席", party: $("rvParty").value || "—",
        note: $("rvNote").value.trim(), status: "new"
      };
      var list = reservations(); list.push(r); saveReservations(list);
      var text = "【私厦里·新闽南 大悦城店】新预约\n" + r.guest + " " + r.party + "位 · " + r.date + " " + r.session + " " + r.time + " · " + r.room +
        (r.phone ? "\n联系电话：" + r.phone : "") + (r.note ? "\n备注：" + r.note : "");
      var smsHref = "sms:" + primaryPhone() + "?body=" + encodeURIComponent(text);
      $("rvResult").hidden = false;
      $("rvResult").innerHTML = "<b>预约已提交</b> — 店家后台已同步收到。<div class=\"ops\">" +
        '<a class="tbtn solid" href="' + smsHref + '">短信通知店家</a>' +
        '<button class="tbtn" id="rvSmsCopy">复制通知文本</button></div>';
      $("rvSmsCopy").addEventListener("click", function () { copyText(text, $("rvSmsCopy")); });
      renderReservations && $("resvList") && renderReservations();
      updateResvBadge();
    });

    $("view-staff").addEventListener("click", function (e) {
      var im = e.target.closest("[data-imgfor]");
      if (im) { state.imgTarget = im.dataset.imgfor; $("dishImgFile").click(); return; }
      var vd = e.target.closest("[data-videofor]");
      if (vd) {
        var id = vd.dataset.videofor;
        var cur = state.dishVideo[id] || "";
        var p = window.prompt("填写菜品视频路径（建议先把视频放入 assets/dishes/videos/ 文件夹）\n例如：assets/dishes/videos/x001.mp4\n留空则清除视频", cur);
        if (p === null) return;
        p = p.trim();
        if (p) state.dishVideo[id] = p; else delete state.dishVideo[id];
        store.set("sl_dish_video", state.dishVideo);
        renderDishes();
      }
    });

    $("ndImgPick").addEventListener("click", function () { $("ndImg").click(); });
    $("ndImg").addEventListener("change", function () {
      var f = this.files && this.files[0];
      var n = f ? f.name : "";
      $("ndImgName").textContent = n.length > 22 ? n.slice(0, 20) + "…" : (n || "未选择文件");
    });
    $("ndAdd").addEventListener("click", function () {
      var name = $("ndName").value.trim();
      if (!name) { alert("请填写菜名"); return; }
      var commit = function (imgData) {
        var priceRaw = $("ndPrice").value.trim();
        var custom = store.get("sl_custom", []);
        var nd = {
          id: "x" + String(state.customNextId).padStart(3, "0"),
          name: name,
          price: priceRaw === "" ? null : parseFloat(priceRaw),
          unit: $("ndUnit").value.trim() || "份",
          category: $("ndCat").value,
          badges: $("ndBadge").value ? [$("ndBadge").value] : [],
          ingredients: $("ndIng").value.trim(),
          preorder: false
        };
        if (imgData) nd.img = imgData;
        var vp = $("ndVideo").value.trim();
        if (vp) nd.video = vp;
        custom.push(nd);
        store.set("sl_custom", custom);
        buildDishes();
        ["ndName", "ndPrice", "ndIng", "ndVideo"].forEach(function (id2) { $(id2).value = ""; });
        $("ndImg").value = ""; $("ndImgName").textContent = "未选择文件";
        renderAdmin(); renderDishes();
        var b = $("ndAdd"); b.textContent = "已上新"; setTimeout(function () { b.textContent = "上新菜品"; }, 1500);
      };
      var f = $("ndImg").files && $("ndImg").files[0];
      if (f) { compressImage(f, commit); } else { commit(null); }
    });
    $("videoClose").addEventListener("click", function () {
      $("videoModal").hidden = true;
      $("dishVideoPlayer").pause && $("dishVideoPlayer").pause();
    });
    $("videoModal").addEventListener("click", function (e) {
      if (e.target === $("videoModal")) { $("videoModal").hidden = true; $("dishVideoPlayer").pause && $("dishVideoPlayer").pause(); }
    });

    /* 菜品图片上传（压缩为 base64 存本机） */
    function compressImage(file, cb) {
      var fr = new FileReader();
      fr.onload = function () {
        var img = new Image();
        img.onload = function () {
          var max = 480, w = img.width, h = img.height;
          if (w > max || h > max) { var r = Math.min(max / w, max / h); w = Math.round(w * r); h = Math.round(h * r); }
          var cv = document.createElement("canvas");
          cv.width = w; cv.height = h;
          cv.getContext("2d").drawImage(img, 0, 0, w, h);
          cb(cv.toDataURL("image/jpeg", 0.72));
        };
        img.src = fr.result;
      };
      fr.readAsDataURL(file);
    }
    $("dishImgFile").addEventListener("change", function () {
      var f = this.files && this.files[0];
      this.value = "";
      if (!f || !state.imgTarget) return;
      compressImage(f, function (data) {
        state.dishImg[state.imgTarget] = data;
        store.set("sl_dish_img", state.dishImg);
        renderAdmin(); renderDishes();
      });
    });
    $("customList").addEventListener("click", function (e) {
      var b = e.target.closest("[data-delcustom]"); if (!b) return;
      var id = b.dataset.delcustom;
      var custom = store.get("sl_custom", []).filter(function (d) { return d.id !== id; });
      store.set("sl_custom", custom);
      delete state.cart[id]; saveCart();
      buildDishes(); renderAdmin(); renderDishes(); renderCartBar();
    });
    $("hideSearch").addEventListener("input", function () { renderHideList(this.value); });
    $("hideList").addEventListener("click", function (e) {
      var b = e.target.closest("[data-hide]"); if (!b) return;
      var hidden = store.get("sl_hidden", {});
      if (hidden[b.dataset.hide]) delete hidden[b.dataset.hide];
      else hidden[b.dataset.hide] = true;
      store.set("sl_hidden", hidden);
      buildDishes(); renderHideList($("hideSearch").value); renderDishes();
    });
    $("tablesSave").addEventListener("click", function () {
      var arr = $("tablesInput").value.split(/[,\n、，]/).map(function (s) { return s.trim(); }).filter(Boolean);
      store.set("sl_tables", arr);
      var b = $("tablesSave"); b.textContent = "已保存（" + arr.length + "个）"; setTimeout(function () { b.textContent = "保存桌号"; }, 1500);
    });
    $("npSave").addEventListener("click", function () {
      var v = $("npPass").value.trim();
      if (!/^\d{4,12}$/.test(v)) { alert("密码需为 4-12 位数字"); return; }
      store.set("sl_admin_pass", v);
      $("npPass").value = "";
      var b = $("npSave"); b.textContent = "已保存"; setTimeout(function () { b.textContent = "保存密码"; }, 1500);
    });
    $("todayOrders").addEventListener("click", function (e) {
      var b = e.target.closest("[data-delorder]"); if (!b) return;
      var orders = store.get(todayKey(), []);
      orders.splice(+b.dataset.delorder, 1);
      store.set(todayKey(), orders); renderOrders();
    });
    $("soldoutSearch").addEventListener("input", function () { renderSoldout(this.value); });
    $("soldoutList").addEventListener("click", function (e) {
      var b = e.target.closest("[data-soldout]"); if (!b) return;
      var id = b.dataset.soldout;
      state.soldout[id] = !state.soldout[id];
      if (!state.soldout[id]) delete state.soldout[id];
      store.set("sl_soldout", state.soldout);
      renderSoldout($("soldoutSearch").value); renderDishes();
    });
    $("ovPhone").value = state.overrides.phone || "";
    $("ovNotice").value = state.overrides.notice || "";
    $("ovSave").addEventListener("click", function () {
      state.overrides = { phone: $("ovPhone").value.trim(), notice: $("ovNotice").value.trim() };
      store.set("sl_overrides", state.overrides);
      renderStatic(); renderView();
      var b = $("ovSave"); b.textContent = "已保存"; setTimeout(function () { b.textContent = "保存"; }, 1500);
    });
    $("exportOrders").addEventListener("click", function () {
      var orders = store.get(todayKey(), []);
      var blob = new Blob([JSON.stringify({ date: todayKey(), orders: orders }, null, 2)], { type: "application/json" });
      var a = document.createElement("a");
      a.href = URL.createObjectURL(blob);
      a.download = "huanxi-orders-" + todayKey().replace("sl_orders_", "") + ".json";
      a.click(); URL.revokeObjectURL(a.href);
    });
    ["rvGuest", "rvDate", "rvSession", "rvTime", "rvRoom", "rvParty"].forEach(function (id) {
      $(id).addEventListener("input", renderReserve);
    });
    $("rvDate").value = new Date().toISOString().slice(0, 10);
    $("rvCopy").addEventListener("click", function () { renderReserve(); copyText($("rvOutput").value, $("rvCopy")); });
    $("btnCopyAddr").addEventListener("click", function () { copyText(D.store.address, $("btnCopyAddr")); });


    function closeViewer() { $("viewer").hidden = true; $("dishVideoPlayer").pause && $("dishVideoPlayer").pause(); }
    $("viewerClose").addEventListener("click", closeViewer);
    $("viewer").addEventListener("click", function (e) { if (e.target === $("viewer")) closeViewer(); });
    function stepViewer(d) {
      if (state.viewerSingle) return;
      state.viewerIdx = (state.viewerIdx + d + state.gallery.length) % state.gallery.length;
      $("viewerImg").src = state.gallery[state.viewerIdx];
      syncViewerCount();
    }
    function syncViewerCount() {
      var c = $("viewerCount");
      if (!c) return;
      if (state.viewerSingle || state.gallery.length <= 1) { c.hidden = true; return; }
      c.hidden = false;
      c.textContent = (state.viewerIdx + 1) + " / " + state.gallery.length;
    }
    $("viewerPrev").addEventListener("click", function () { stepViewer(-1); });
    $("viewerNext").addEventListener("click", function () { stepViewer(1); });
    var tx = null;
    $("viewer").addEventListener("touchstart", function (e) { tx = e.touches[0].clientX; }, { passive: true });
    $("viewer").addEventListener("touchend", function (e) {
      if (tx === null) return;
      var dx = e.changedTouches[0].clientX - tx; tx = null;
      if (Math.abs(dx) > 42) stepViewer(dx < 0 ? 1 : -1);
    }, { passive: true });
    document.addEventListener("keydown", function (e) {
      if (!$("viewer").hidden) {
        if (e.key === "Escape") closeViewer();
        if (e.key === "ArrowLeft") stepViewer(-1);
        if (e.key === "ArrowRight") stepViewer(1);
      }
    });
    $("menuSearch").addEventListener("input", function () {
      state.search = this.value;
      $("menuSearchClear").hidden = !this.value;
      renderDishes();
    });
    $("menuSearchClear").addEventListener("click", function () {
      $("menuSearch").value = ""; state.search = "";
      $("menuSearchClear").hidden = true; renderDishes();
    });
    $("filterToggle") && $("filterToggle").addEventListener("click", function () {
      $("filterBar").classList.toggle("open");
    });
    $("catRail") && $("catRail").addEventListener("click", function (e) {
      var a = e.target.closest("[data-rail]"); if (!a) return;
      var sec = document.getElementById("sec-" + a.dataset.rail);
      if (sec && typeof sec.scrollIntoView === "function") sec.scrollIntoView({ behavior: "smooth", block: "start" });
    });
    var lastY = 0;
    window.addEventListener("scroll", function () {
      var y = window.pageYOffset || 0;
      var bt = $("backTop");
      if (bt) bt.hidden = y < 600;
      syncBrand();
      if (state.view === "menu") {
        if (y > 140 && y - lastY > 6) $("priceWrap").classList.add("hide");
        else if (lastY - y > 6 || y <= 140) $("priceWrap").classList.remove("hide");
        syncRail();
      }
      lastY = y;
    });
    $("backTop").addEventListener("click", function () { window.scrollTo({ top: 0, behavior: "smooth" }); });
    $("myOrdersEntry").addEventListener("click", function () {
      var list = custOrders().slice().reverse();
      var stMap = { new: ["new", "待接单"], ok: ["ok", "已接单"], done: ["done", "已完成"] };
      $("myOrdersList").innerHTML = list.map(function (o) {
        var st = stMap[o.status] || stMap.new;
        return '<div class="cust-order"><div class="head"><span class="no">No.' + o.no + "</span>" +
          "<b>" + o.table + "</b><span>" + (o.date || "") + " " + o.time + "</span>" +
          '<span class="resv-st ' + st[0] + '">' + st[1] + "</span>" +
          '<span style="margin-left:auto">¥' + o.total + "</span></div>" +
          '<div class="items">' + o.items.map(function (it) { return it.name + "×" + it.qty; }).join("、") + "</div></div>";
      }).join("") || '<p class="cap">本机还没有订单记录。</p>';
      $("myOrdersModal").hidden = false;
    });
    $("myOrdersClose").addEventListener("click", function () { $("myOrdersModal").hidden = true; });
    $("myOrdersModal").addEventListener("click", function (e) { if (e.target === $("myOrdersModal")) $("myOrdersModal").hidden = true; });
    window.addEventListener("hashchange", renderView);
  }

  function applyMode() {
    var staff = state.mode === "staff";
    $("view-staff").hidden = !staff;
    var ms = $("modeSwitch");
    if (ms) ms.querySelectorAll("button").forEach(function (b) {
      b.classList.toggle("on", b.dataset.mode === state.mode);
    });
    var se = $("staffEntry");
    if (se) se.textContent = staff ? "退出店家模式" : "店家入口";
  }

  /* ---------- 启动 ---------- */
  if (state.mode === "staff") { state.mode = "customer"; store.set("sl_mode", "customer"); }
  renderStatic();
  bind();
  applyMode();
  renderCartBar();
  if (!window.location.hash) window.location.hash = "#/home";
  renderView();
})();
