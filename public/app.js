(() => {
  const $ = (s) => document.querySelector(s);
  const STORE_CONTACTS = "safeher.contacts";
  const STORE_MSG = "safeher.message";
  const DEFAULT_MSG = "SOS! I need help. Please call me or come to my location immediately.";
  const HOLD_MS = 2000;

  const state = {
    contacts: load(STORE_CONTACTS, []),
    message: localStorage.getItem(STORE_MSG) || DEFAULT_MSG,
    position: null,
    watchId: null,
    sosActive: false,
  };

  function load(key, fallback) {
    try { return JSON.parse(localStorage.getItem(key)) ?? fallback; } catch { return fallback; }
  }

  function toast(text) {
    const t = $("#toast");
    t.textContent = text;
    t.classList.add("show");
    clearTimeout(toast.timer);
    toast.timer = setTimeout(() => t.classList.remove("show"), 2600);
  }

  // ---------- Contacts ----------
  const list = $("#contactList");

  function renderContacts() {
    list.innerHTML = "";
    if (!state.contacts.length) {
      const li = document.createElement("li");
      li.className = "empty";
      li.textContent = "No trusted contacts yet — add someone you trust.";
      list.append(li);
      return;
    }
    state.contacts.forEach((c, i) => {
      const li = document.createElement("li");
      const av = document.createElement("span");
      av.className = "av";
      av.textContent = c.name.trim().charAt(0).toUpperCase();
      const info = document.createElement("div");
      info.className = "info";
      const b = document.createElement("b");
      b.textContent = c.name;
      const s = document.createElement("span");
      s.textContent = c.phone;
      info.append(b, s);
      const call = document.createElement("a");
      call.className = "icon-btn";
      call.href = `tel:${cleanPhone(c.phone)}`;
      call.setAttribute("aria-label", `Call ${c.name}`);
      call.textContent = "📞";
      const del = document.createElement("button");
      del.className = "icon-btn";
      del.setAttribute("aria-label", `Remove ${c.name}`);
      del.textContent = "✕";
      del.onclick = () => {
        state.contacts.splice(i, 1);
        saveContacts();
      };
      li.append(av, info, call, del);
      list.append(li);
    });
  }

  function saveContacts() {
    localStorage.setItem(STORE_CONTACTS, JSON.stringify(state.contacts));
    renderContacts();
    updateShareLinks();
  }

  const cleanPhone = (p) => p.replace(/[^\d+]/g, "");

  $("#contactForm").addEventListener("submit", (e) => {
    e.preventDefault();
    const f = e.target;
    const name = f.elements.name.value.trim();
    const phone = f.elements.phone.value.trim();
    if (!name || cleanPhone(phone).length < 6) return toast("Enter a valid name and phone");
    state.contacts.push({ name, phone });
    saveContacts();
    f.reset();
    f.elements.name.focus();
    toast(`${name} added`);
  });

  const customMsg = $("#customMsg");
  customMsg.value = state.message;
  customMsg.addEventListener("input", () => {
    state.message = customMsg.value.trim() || DEFAULT_MSG;
    localStorage.setItem(STORE_MSG, state.message);
  });

  // ---------- Location ----------
  function mapsLink(pos) {
    const { latitude, longitude } = pos.coords;
    return `https://maps.google.com/?q=${latitude.toFixed(6)},${longitude.toFixed(6)}`;
  }

  function buildMessage() {
    let msg = state.message;
    if (state.position) {
      msg += `\n\nMy location: ${mapsLink(state.position)}`;
      msg += `\n(accuracy ~${Math.round(state.position.coords.accuracy)}m, ${new Date(state.position.timestamp).toLocaleTimeString()})`;
    } else {
      msg += "\n\n(Location unavailable)";
    }
    return msg;
  }

  function renderLocation() {
    const el = $("#locText");
    if (!state.position) return;
    const link = mapsLink(state.position);
    el.innerHTML = "";
    el.append("📍 Location captured · ");
    const a = document.createElement("a");
    a.href = link;
    a.target = "_blank";
    a.rel = "noopener";
    a.textContent = "view on map";
    el.append(a, ` · ±${Math.round(state.position.coords.accuracy)}m`);
  }

  function onPosition(pos) {
    state.position = pos;
    renderLocation();
    $("#sosMessage").value = buildMessage();
    updateShareLinks();
  }

  function onPositionError(err) {
    const msg = err.code === 1
      ? "Location permission denied. Enable it in browser settings — you can still send the message."
      : "Couldn't get location. Move near a window or open area and try again.";
    $("#locText").textContent = "⚠️ " + msg;
    $("#sosMessage").value = buildMessage();
    updateShareLinks();
  }

  function getLocation() {
    return new Promise((resolve) => {
      if (!("geolocation" in navigator)) {
        onPositionError({ code: 0 });
        return resolve(null);
      }
      navigator.geolocation.getCurrentPosition(
        (p) => { onPosition(p); resolve(p); },
        (e) => { onPositionError(e); resolve(null); },
        { enableHighAccuracy: true, timeout: 15000, maximumAge: 10000 }
      );
    });
  }

  function startWatch() {
    if (state.watchId != null || !("geolocation" in navigator)) return;
    state.watchId = navigator.geolocation.watchPosition(onPosition, () => {}, {
      enableHighAccuracy: true, maximumAge: 5000,
    });
  }

  function stopWatch() {
    if (state.watchId != null) navigator.geolocation.clearWatch(state.watchId);
    state.watchId = null;
  }

  // ---------- Sharing ----------
  function currentText() {
    return $("#sosMessage").value || buildMessage();
  }

  function updateShareLinks() {
    const text = encodeURIComponent(currentText());
    const nums = state.contacts.map((c) => cleanPhone(c.phone)).join(",");
    // "?&body=" works on both iOS and Android SMS handlers
    $("#shareSms").href = `sms:${nums}?&body=${text}`;
    $("#shareWa").href = `https://wa.me/?text=${text}`;
  }

  $("#sosMessage").addEventListener("input", updateShareLinks);

  $("#shareSms").addEventListener("click", () => {
    if (!state.contacts.length) toast("Tip: add trusted contacts to pre-fill recipients");
  });

  $("#shareNative").addEventListener("click", async () => {
    const text = currentText();
    if (navigator.share) {
      try { await navigator.share({ title: "SOS", text }); } catch { /* cancelled */ }
    } else {
      try {
        await navigator.clipboard.writeText(text);
        toast("SOS message copied — paste it anywhere");
      } catch {
        toast("Use Text contacts or WhatsApp to send");
      }
    }
  });

  // ---------- SOS ----------
  const sosBtn = $("#sosBtn");
  const panel = $("#sosPanel");
  let holdTimer = null;

  function startHold(e) {
    if (e.type === "keydown" && e.key !== " " && e.key !== "Enter") return;
    if (e.type === "keydown" && e.repeat) return;
    e.preventDefault();
    if (state.sosActive) return;
    sosBtn.classList.add("holding");
    $("#sosHint").textContent = "Keep holding…";
    if (navigator.vibrate) navigator.vibrate(30);
    holdTimer = setTimeout(triggerSos, HOLD_MS);
  }

  function endHold() {
    if (!holdTimer) return;
    clearTimeout(holdTimer);
    holdTimer = null;
    sosBtn.classList.remove("holding");
    if (!state.sosActive) $("#sosHint").textContent = "Hold 2s";
  }

  async function triggerSos() {
    holdTimer = null;
    state.sosActive = true;
    sosBtn.classList.remove("holding");
    sosBtn.classList.add("active");
    $("#sosHint").textContent = "Active";
    $("#netStatus").textContent = "SOS active";
    $("#netStatus").classList.add("live");
    if (navigator.vibrate) navigator.vibrate([200, 100, 200, 100, 400]);

    panel.hidden = false;
    $("#locText").textContent = "Getting your location…";
    $("#sosMessage").value = buildMessage();
    updateShareLinks();
    panel.scrollIntoView({ behavior: "smooth", block: "start" });

    await getLocation();
    if ($("#liveTrack").checked) startWatch();
    toast(state.contacts.length ? "Send the SOS to your contacts below" : "Share the SOS or call 112");
  }

  function cancelSos() {
    state.sosActive = false;
    stopWatch();
    panel.hidden = true;
    sosBtn.classList.remove("active");
    $("#sosHint").textContent = "Hold 2s";
    $("#netStatus").textContent = "Ready";
    $("#netStatus").classList.remove("live");
  }

  sosBtn.addEventListener("pointerdown", startHold);
  sosBtn.addEventListener("keydown", startHold);
  ["pointerup", "pointerleave", "pointercancel", "keyup", "blur"].forEach((ev) => sosBtn.addEventListener(ev, endHold));
  sosBtn.addEventListener("contextmenu", (e) => e.preventDefault());
  $("#cancelSos").addEventListener("click", cancelSos);
  $("#liveTrack").addEventListener("change", (e) => {
    if (!state.sosActive) return;
    e.target.checked ? startWatch() : stopWatch();
  });

  $("#shareLocBtn").addEventListener("click", async () => {
    panel.hidden = false;
    $("#locText").textContent = "Getting your location…";
    panel.scrollIntoView({ behavior: "smooth", block: "start" });
    await getLocation();
  });

  // ---------- Siren ----------
  let audio = null;
  const sirenBtn = $("#sirenBtn");
  const flash = $("#flash");

  function startSiren() {
    const ctx = new (window.AudioContext || window.webkitAudioContext)();
    const osc = ctx.createOscillator();
    const lfo = ctx.createOscillator();
    const lfoGain = ctx.createGain();
    const gain = ctx.createGain();
    osc.type = "sawtooth";
    osc.frequency.value = 900;
    lfo.type = "triangle";
    lfo.frequency.value = 1.6;
    lfoGain.gain.value = 450;
    gain.gain.value = 0.9;
    lfo.connect(lfoGain).connect(osc.frequency);
    osc.connect(gain).connect(ctx.destination);
    osc.start();
    lfo.start();
    audio = ctx;
    flash.hidden = false;
    sirenBtn.setAttribute("aria-pressed", "true");
    sirenBtn.querySelector("b").textContent = "Stop siren";
  }

  function stopSiren() {
    if (audio) audio.close();
    audio = null;
    flash.hidden = true;
    sirenBtn.setAttribute("aria-pressed", "false");
    sirenBtn.querySelector("b").textContent = "Siren";
  }

  sirenBtn.addEventListener("click", () => (audio ? stopSiren() : startSiren()));
  flash.addEventListener("click", stopSiren);
  document.addEventListener("keydown", (e) => { if (e.key === "Escape" && audio) stopSiren(); });

  // ---------- Fake call ----------
  const fakeCall = $("#fakeCall");
  let ringCtx = null;
  let ringTimer = null;
  let callTimer = null;

  function ring() {
    ringCtx = new (window.AudioContext || window.webkitAudioContext)();
    const beep = () => {
      if (!ringCtx) return;
      const o = ringCtx.createOscillator();
      const g = ringCtx.createGain();
      o.frequency.value = 520;
      g.gain.setValueAtTime(0.3, ringCtx.currentTime);
      g.gain.setValueAtTime(0, ringCtx.currentTime + 0.9);
      o.connect(g).connect(ringCtx.destination);
      o.start();
      o.stop(ringCtx.currentTime + 1);
      if (navigator.vibrate) navigator.vibrate([400, 200, 400]);
    };
    beep();
    ringTimer = setInterval(beep, 2000);
  }

  function stopRing() {
    clearInterval(ringTimer);
    if (ringCtx) ringCtx.close();
    ringCtx = null;
  }

  function endCall() {
    stopRing();
    clearInterval(callTimer);
    fakeCall.hidden = true;
  }

  $("#fakeCallBtn").addEventListener("click", () => {
    toast("Fake call in 10 seconds");
    setTimeout(() => {
      $("#callState").textContent = "Incoming call…";
      fakeCall.hidden = false;
      ring();
    }, 10000);
  });

  $("#declineCall").addEventListener("click", endCall);
  $("#acceptCall").addEventListener("click", () => {
    stopRing();
    $("#acceptCall").hidden = true;
    let s = 0;
    $("#callState").textContent = "00:00";
    callTimer = setInterval(() => {
      s++;
      $("#callState").textContent = `${String(Math.floor(s / 60)).padStart(2, "0")}:${String(s % 60).padStart(2, "0")}`;
    }, 1000);
  });
  $("#declineCall").addEventListener("click", () => { $("#acceptCall").hidden = false; });

  // ---------- Init ----------
  renderContacts();
  updateShareLinks();
  window.addEventListener("offline", () => toast("You're offline — calls and SMS still work"));
})();
