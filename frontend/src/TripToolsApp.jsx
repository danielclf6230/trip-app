import ScheduleImport from "./ScheduleImport";
import { appendImportedStops } from "./scheduleCsv";
import { reorderScheduleItems } from "./scheduleOrder";
import { useEffect, useMemo, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import {
  addUserToGroup,
  changePassword,
  createAdminUser,
  createInvite,
  createTrip,
  deleteAdminUser,
  deleteTrip,
  loadAdminOverview,
  loadExchangeRate,
  loadTrip,
  loadTrips,
  removeUserFromGroup,
  resetUserPassword,
  saveTrip,
  selectActiveTrip,
  updateAvatar,
  loadAvatar,
  loadShoppingPhotos,
  uploadShoppingPhoto,
  deleteShoppingItem,
} from "./api";
import { getUser, logout, setUser } from "./auth";
import { mergeTripChanges, tripsAreEqual } from "./tripMerge";

const emptyTrip = {
  tripName: "My Adventure",
  country: "",
  city: "",
  startDate: "",
  endDate: "",
  shoppingCurrency: "CAD",
  shoppingBudget: 0,
  shopping: [],
  days: [],
  travelers: [],
  wheelResults: {},
  notes: "",
};

const makeId = () => crypto.randomUUID?.() || `${Date.now()}-${Math.random()}`;
const DEFAULT_WHEEL_PARTS = 4;
const MAX_WHEEL_PARTS = 12;

function wheelPartCount(person) {
  const parts = Number(person?.parts);
  return Number.isInteger(parts)
    ? Math.min(MAX_WHEEL_PARTS, Math.max(1, parts))
    : DEFAULT_WHEEL_PARTS;
}

function wheelSegments(travelers = []) {
  const remaining = travelers.map(wheelPartCount);
  const segments = [];
  while (remaining.some(Boolean)) {
    travelers.forEach((person, travelerIndex) => {
      if (remaining[travelerIndex] > 0) {
        segments.push({ person, travelerIndex });
        remaining[travelerIndex] -= 1;
      }
    });
  }
  return segments;
}

function upgradeTravelers(travelers = []) {
  const groups = new Map();
  travelers.forEach((person) => {
    const key = person.name.trim().toLocaleLowerCase();
    const group = groups.get(key) || [];
    group.push(person);
    groups.set(key, group);
  });
  return [...groups.values()].flatMap((group) => {
    const isLegacyDuplicate = group.length > 1 && group.every((person) => person.parts == null);
    if (!isLegacyDuplicate) {
      return group.map((person) => ({ ...person, parts: wheelPartCount(person) }));
    }
    return [{ ...group[0], parts: Math.min(MAX_WHEEL_PARTS, group.length) }];
  });
}

function prepareTrip(value) {
  return value
    ? { ...emptyTrip, ...value, travelers: upgradeTravelers(value.travelers) }
    : emptyTrip;
}

const SHOPPING_CURRENCIES = [
  ["CAD", "Canadian Dollar"],
  ["USD", "US Dollar"],
  ["EUR", "Euro"],
  ["GBP", "British Pound"],
  ["JPY", "Japanese Yen"],
  ["CNY", "Chinese Yuan"],
  ["AUD", "Australian Dollar"],
  ["NZD", "New Zealand Dollar"],
  ["CHF", "Swiss Franc"],
  ["HKD", "Hong Kong Dollar"],
  ["SGD", "Singapore Dollar"],
  ["KRW", "South Korean Won"],
  ["INR", "Indian Rupee"],
  ["MXN", "Mexican Peso"],
  ["BRL", "Brazilian Real"],
  ["AED", "UAE Dirham"],
  ["THB", "Thai Baht"],
  ["PHP", "Philippine Peso"],
];

function CurrencyPicker({ value, onChange, label = "CURRENCY" }) {
  const pickerRef = useRef(null);
  const selectedName = SHOPPING_CURRENCIES.find(([code]) => code === value)?.[1];

  useEffect(() => {
    const closeOnOutsideClick = (event) => {
      const picker = pickerRef.current;
      if (picker && !picker.contains(event.target)) picker.open = false;
    };
    document.addEventListener("pointerdown", closeOnOutsideClick);
    return () => document.removeEventListener("pointerdown", closeOnOutsideClick);
  }, []);

  return (
    <div className="currency-select">
      <span>{label}</span>
      <details
        ref={pickerRef}
        className="currency-picker"
        onKeyDown={(event) => {
          if (event.key === "Escape") {
            pickerRef.current.open = false;
            pickerRef.current.querySelector("summary")?.focus();
          }
        }}
      >
        <summary aria-label={`${label}: ${value}, ${selectedName}`}>{value}</summary>
        <div className="currency-menu" aria-label={`${label.toLowerCase()} currency`}>
          {SHOPPING_CURRENCIES.map(([code, name]) => (
            <button
              type="button"
              aria-pressed={code === value}
              className={code === value ? "selected" : ""}
              value={code}
              key={code}
              onClick={() => {
                onChange(code);
                pickerRef.current.open = false;
              }}
            >
              <strong>{code}</strong>
              <small>{name}</small>
              {code === value && <span aria-hidden="true">✓</span>}
            </button>
          ))}
        </div>
      </details>
    </div>
  );
}
const emptyStop = () => ({
  id: makeId(),
  place: "",
  time: "",
  duration: "",
  note: "",
  checked: false,
});

function dateAt(value) {
  if (!value) return null;
  const [year, month, day] = value.split("-").map(Number);
  return new Date(year, month - 1, day);
}

function localDate(now = new Date()) {
  const year = now.getFullYear();
  const month = String(now.getMonth() + 1).padStart(2, "0");
  const day = String(now.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

function prettyDate(value, options = {}) {
  const date = dateAt(value);
  if (!date) return "Set a date";
  return new Intl.DateTimeFormat("en-US", {
    month: "short",
    day: "numeric",
    weekday: options.weekday ? "short" : undefined,
    year: options.year ? "numeric" : undefined,
  }).format(date);
}

function datesBetween(start, end) {
  const first = dateAt(start);
  const last = dateAt(end);
  if (!first || !last || last < first) return [];
  const result = [];
  for (
    let cursor = first;
    cursor <= last && result.length < 60;
    cursor = new Date(
      cursor.getFullYear(),
      cursor.getMonth(),
      cursor.getDate() + 1,
    )
  ) {
    result.push(localDate(cursor));
  }
  return result;
}

function countdown(target, now) {
  const diff = target?.getTime() - now.getTime();
  if (!target || diff <= 0) return null;
  const days = Math.floor(diff / 86400000);
  const hours = Math.floor((diff % 86400000) / 3600000);
  const minutes = Math.floor((diff % 3600000) / 60000);
  return { days, hours, minutes };
}

function tripIsCompleted(trip, today = localDate()) {
  return Boolean(trip?.endDate && today > trip.endDate);
}

function resizeAvatar(file) {
  return new Promise((resolve, reject) => {
    const image = new Image();
    const objectUrl = URL.createObjectURL(file);
    image.onload = () => {
      const size = Math.min(image.naturalWidth, image.naturalHeight);
      const sourceX = (image.naturalWidth - size) / 2;
      const sourceY = (image.naturalHeight - size) / 2;
      const canvas = document.createElement("canvas");
      canvas.width = 512;
      canvas.height = 512;
      const context = canvas.getContext("2d");
      context.fillStyle = "#faf7f0";
      context.fillRect(0, 0, 512, 512);
      context.drawImage(image, sourceX, sourceY, size, size, 0, 0, 512, 512);
      URL.revokeObjectURL(objectUrl);
      resolve(canvas.toDataURL("image/jpeg", 0.84));
    };
    image.onerror = () => {
      URL.revokeObjectURL(objectUrl);
      reject(new Error("That image could not be read."));
    };
    image.src = objectUrl;
  });
}

const Icon = ({ name }) => {
  const icons = { shop: "SHOP", plan: "PLAN", exchange: "FX", wheel: "PICK", note: "NOTE" };
  return (
    <span className="tab-kanji" aria-hidden="true">
      {icons[name]}
    </span>
  );
};

export default function TripToolsApp() {
  const nav = useNavigate();
  const user = getUser();
  const [account, setAccount] = useState(user);
  const userId = account?.id;
  useEffect(() => {
    let alive = true;
    async function refreshAvatar() {
      try {
        const { avatarUrl } = await loadAvatar();
        if (alive) {
          setAccount(current => ({ ...current, avatarUrl }));
          const current = getUser();
          if (current?.id === userId) setUser({ ...current, avatarUrl });
        }
      } catch (error) { console.error("Avatar refresh failed:", error.message); }
    }
    refreshAvatar();
    const timer = setInterval(refreshAvatar, 45 * 60 * 1000);
    const onVisible = () => { if (document.visibilityState === "visible") refreshAvatar(); };
    document.addEventListener("visibilitychange", onVisible);
    return () => { alive = false; clearInterval(timer); document.removeEventListener("visibilitychange", onVisible); };
  }, [userId]);

  const [trip, setTrip] = useState(emptyTrip);
  const [tripId, setTripId] = useState(null);
  const [tripList, setTripList] = useState([]);
  const [view, setView] = useState("trip");
  const [canCreateTrips, setCanCreateTrips] = useState(false);
  const [canManageUsers, setCanManageUsers] = useState(false);
  const [tab, setTab] = useState("schedule");
  const [loaded, setLoaded] = useState(false);
  const [saveState, setSaveState] = useState("Loading…");
  const [now, setNow] = useState(new Date());
  const [shoppingText, setShoppingText] = useState("");
  const [editingShop, setEditingShop] = useState(null);
  const [planning, setPlanning] = useState(false);
  const [newTraveler, setNewTraveler] = useState("");
  const [winner, setWinner] = useState("");
  const [spinning, setSpinning] = useState(false);
  const [rotation, setRotation] = useState(0);
  const [shareOpen, setShareOpen] = useState(false);
  const [invite, setInvite] = useState("");
  const [profileOpen, setProfileOpen] = useState(false);
  const [manageOpen, setManageOpen] = useState(false);
  const [canInvite, setCanInvite] = useState(false);
  const firstLoad = useRef(true);
  const viewingCompletedTrip = useRef(false);
  const syncedTrip = useRef(emptyTrip);
  const latestTrip = useRef(emptyTrip);
  const activeTripId = useRef(null);
  const saveQueue = useRef(Promise.resolve());

  useEffect(() => {
    latestTrip.current = trip;
  }, [trip]);

  useEffect(() => {
    async function prepareTrips() {
      try {
        const data = await loadTrips();
        setTripList(data.trips);
        setCanCreateTrips(data.canCreate);
        setCanManageUsers(data.canManage);
        const storageKey = `trip-tools-active-trip-${userId || "account"}`;
        const storedView = localStorage.getItem(storageKey);
        const savedId = Number(storedView);
        const activeId = data.activeTripId || savedId;
        const savedTrip = data.trips.find((item) => item.id === activeId);
        const onlyCurrentTrip = storedView !== "list" && data.trips.length === 1 && !tripIsCompleted(data.trips[0])
          ? data.trips[0]
          : null;
        const initialTrip = savedTrip && !tripIsCompleted(savedTrip)
          ? savedTrip
          : onlyCurrentTrip;
        if (initialTrip) {
          const selected = await loadTrip(initialTrip.id);
          const prepared = prepareTrip(selected.trip);
          activeTripId.current = selected.id;
          syncedTrip.current = prepared;
          latestTrip.current = prepared;
          setTripId(selected.id);
          setTrip(prepared);
          setCanInvite(selected.canInvite);
          setView("trip");
        } else {
          localStorage.setItem(storageKey, "list");
          setView("list");
          setSaveState("Trips ready");
        }
      } catch (error) {
        setSaveState(`Offline: ${error.message}`);
      } finally {
        setLoaded(true);
        firstLoad.current = false;
      }
    }
    prepareTrips();
  }, [userId]);

  useEffect(() => {
    const timer = setInterval(() => setNow(new Date()), 30000);
    return () => clearInterval(timer);
  }, []);

  useEffect(() => {
    if (!loaded || firstLoad.current || view !== "trip" || !tripId) return undefined;
    if (tripsAreEqual(trip, syncedTrip.current)) return undefined;
    setSaveState("Saving…");
    const timer = setTimeout(() => {
      const savingTripId = tripId;
      saveQueue.current = saveQueue.current.then(async () => {
        if (activeTripId.current !== savingTripId) return;
        const proposed = latestTrip.current;
        const base = syncedTrip.current;
        if (tripsAreEqual(proposed, base)) return;

        try {
          const result = await saveTrip(savingTripId, proposed, base);
          if (activeTripId.current !== savingTripId) return;
          const serverTrip = prepareTrip(result.trip);
          syncedTrip.current = serverTrip;
          setTrip((current) => {
            const rebased = prepareTrip(
              mergeTripChanges(proposed, current, serverTrip),
            );
            latestTrip.current = rebased;
            return tripsAreEqual(current, rebased) ? current : rebased;
          });
          setSaveState("Saved");
          setTripList((current) => current.map((item) => item.id === savingTripId
            ? { ...item, tripName: serverTrip.tripName, country: serverTrip.country, city: serverTrip.city, startDate: serverTrip.startDate, endDate: serverTrip.endDate }
            : item));
        } catch (error) {
          if (activeTripId.current === savingTripId)
            setSaveState(`Not saved: ${error.message}`);
        }
      });
    }, 650);
    return () => clearTimeout(timer);
  }, [trip, tripId, loaded, view]);

  const todayLocal = localDate(now);
  const localTimezone =
    Intl.DateTimeFormat().resolvedOptions().timeZone || "Local time";
  useEffect(() => {
    if (!loaded) return;
    const hasOldOpenDay = trip.days.some(
      (day) => day.date < todayLocal && !day.completed,
    );
    if (hasOldOpenDay)
      setTrip((current) => ({
        ...current,
        days: current.days.map((day) =>
          day.date < todayLocal ? { ...day, completed: true } : day,
        ),
      }));
  }, [todayLocal, loaded, trip.days]);

  const tripDates = useMemo(
    () => datesBetween(trip.startDate, trip.endDate),
    [trip.startDate, trip.endDate],
  );
  const activeIndex = trip.days.findIndex((day) => day.date === todayLocal);
  const activeDay = activeIndex >= 0 ? trip.days[activeIndex] : null;
  const tripStarted = trip.startDate && todayLocal >= trip.startDate;
  const tripEnded = trip.endDate && todayLocal > trip.endDate;
  const showActive = activeDay && !activeDay.completed && !planning;
  const beforeTrip = trip.startDate && todayLocal < trip.startDate;
  const nextDay = trip.days.find(
    (day) => day.date > todayLocal && !day.completed,
  );
  const nextCountdown =
    activeDay?.completed && nextDay
      ? countdown(dateAt(nextDay.date), now)
      : null;
  const tripCountdown = beforeTrip
    ? countdown(dateAt(trip.startDate), now)
    : null;

  async function refreshTrips() {
    const data = await loadTrips();
    setTripList(data.trips);
    setCanCreateTrips(data.canCreate);
    setCanManageUsers(data.canManage);
    return data.trips;
  }

  async function openTripProfile(id) {
    setSaveState("Loading…");
    await selectActiveTrip(id);
    const selected = await loadTrip(id);
    const prepared = prepareTrip(selected.trip);
    viewingCompletedTrip.current = tripIsCompleted(
      tripList.find((item) => item.id === id) || selected.trip,
    );
    activeTripId.current = selected.id;
    syncedTrip.current = prepared;
    latestTrip.current = prepared;
    setTripId(selected.id);
    setTrip(prepared);
    setCanInvite(selected.canInvite);
    setInvite("");
    setView("trip");
    setSaveState("Saved");
    localStorage.setItem(
      `trip-tools-active-trip-${userId || "account"}`,
      String(selected.id),
    );
  }

  async function showTripList() {
    try {
      await refreshTrips();
      viewingCompletedTrip.current = false;
      activeTripId.current = null;
      await selectActiveTrip(null);
      localStorage.setItem(`trip-tools-active-trip-${userId || "account"}`, "list");
      setView("list");
      setSaveState("Trips ready");
    } catch (error) {
      setSaveState(`Offline: ${error.message}`);
    }
  }

  async function addTripProfile(values) {
    const created = await createTrip(values);
    await refreshTrips();
    await openTripProfile(created.id);
  }

  useEffect(() => {
    if (!loaded || view !== "trip" || !tripId || !tripEnded || viewingCompletedTrip.current) return undefined;
    const timer = setTimeout(async () => {
      try {
        const result = await saveTrip(tripId, trip, syncedTrip.current);
        syncedTrip.current = prepareTrip(result.trip);
        await refreshTrips();
        await selectActiveTrip(null);
        activeTripId.current = null;
        localStorage.setItem(`trip-tools-active-trip-${userId || "account"}`, "list");
        setView("list");
        setSaveState("Trip completed");
      } catch (error) {
        setSaveState(`Not saved: ${error.message}`);
      }
    }, 800);
    return () => clearTimeout(timer);
  }, [loaded, view, tripId, tripEnded, trip, userId]);

  function updateTripDates(startDate, endDate) {
    const dates = datesBetween(startDate, endDate);
    setTrip((current) => ({
      ...current,
      startDate,
      endDate,
      days: dates.map(
        (date) =>
          current.days.find((day) => day.date === date) || {
            id: makeId(),
            date,
            completed: false,
            items: [emptyStop()],
          },
      ),
    }));
  }

  function updateDay(dayId, callback) {
    setTrip((current) => ({
      ...current,
      days: current.days.map((day) => (day.id === dayId ? callback(day) : day)),
    }));
  }

  function addShopping(event) {
    event.preventDefault();
    if (!shoppingText.trim()) return;
    setTrip((current) => ({
      ...current,
      shopping: [
        ...current.shopping,
        { id: makeId(), text: shoppingText.trim(), checked: false, price: 0 },
      ],
    }));
    setShoppingText("");
  }

  function spinWheel() {
    if (trip.travelers.length < 2 || spinning) return;
    const segments = wheelSegments(trip.travelers);
    const selected = Math.floor(Math.random() * segments.length);
    const segment = 360 / segments.length;
    const desired = (360 - (selected * segment + segment / 2)) % 360;
    const delta = (desired - (rotation % 360) + 360) % 360;
    const target = rotation + 1440 + delta;
    setWinner("");
    setSpinning(true);
    setRotation(target);
    setTimeout(() => {
      const selectedPerson = segments[selected].person;
      setWinner(selectedPerson.name);
      setTrip((current) => ({
        ...current,
        wheelResults: {
          ...(current.wheelResults || {}),
          [selectedPerson.id]: (current.wheelResults?.[selectedPerson.id] || 0) + 1,
        },
      }));
      setSpinning(false);
    }, 3800);
  }

  function openSharing() {
    setShareOpen(true);
  }

  async function makeInvite() {
    try {
      const result = await createInvite(tripId);
      setInvite(result.code);
    } catch (error) {
      setInvite(error.message);
    }
  }

  if (!loaded)
    return (
      <div className="app-loading">
        <span>TT</span>
        <p>Preparing your journey…</p>
      </div>
    );

  return (
    <main className="trip-shell">
      <header className="app-header">
        <div className="brand">
          <span className="brand-mark">TT</span>
          <div>
            <strong>TRIP TOOLS</strong>
            <small>
              {view === "trip" && (trip.city || trip.country)
                ? [trip.city, trip.country].filter(Boolean).join(" · ").toUpperCase()
                : "YOUR JOURNEYS · TOGETHER"}
            </small>
          </div>
        </div>
        <div className="header-actions">
          <span
            className={`save-state ${saveState !== "Saved" ? "working" : ""}`}
          >
            {saveState}
          </span>
          {view === "trip" && (tripList.length > 1 || canCreateTrips) && (
            <button className="share-btn trip-list-btn" onClick={showTripList}>
              All trips
            </button>
          )}
          {view === "trip" && canInvite && (
            <button className="share-btn" onClick={openSharing}>
              ＋ Invite
            </button>
          )}
          {canManageUsers && (
            <button
              className="manage-users-btn"
              onClick={() => setManageOpen(true)}
            >
              Manage users
            </button>
          )}
          <button
            className="avatar"
            onClick={() => setProfileOpen(true)}
            title="Account and password"
          >
            {account?.avatarUrl ? (
              <img src={account.avatarUrl} alt="" />
            ) : (
              (account?.name || "T")[0].toUpperCase()
            )}
          </button>
          <button
            className="logout"
            onClick={() => {
              logout();
              nav("/", { replace: true });
            }}
          >
            Log out
          </button>
        </div>
      </header>

      {view === "list" ? (
        <TripList
          trips={tripList}
          canCreate={canCreateTrips}
          onOpen={openTripProfile}
          onCreate={addTripProfile}
          onDelete={async (id) => {
            await deleteTrip(id);
            await refreshTrips();
          }}
        />
      ) : (
        <>
      <section className="trip-hero">
        <div className="sun-disc" aria-hidden="true" />
        <span className="hero-city-watermark" aria-hidden="true">
          {trip.city || "GO"}
        </span>
        <div className="hero-copy">
          <div className="eyebrow">
            {[trip.city, trip.country].filter(Boolean).join(" · ") || "YOUR NEXT JOURNEY"}
            <span>PLAN · SHARE · GO</span>
          </div>
          <input
            className={`trip-name ${trip.tripName.length > 24 ? "very-long-name" : trip.tripName.length > 16 ? "long-name" : ""}`}
            value={trip.tripName}
            onChange={(e) => setTrip({ ...trip, tripName: e.target.value })}
            aria-label="Trip name"
          />
          <div className="date-range">
            <label>
              FROM
              <input
                type="date"
                value={trip.startDate}
                onChange={(e) => updateTripDates(e.target.value, trip.endDate)}
              />
            </label>
            <span className="range-line">→</span>
            <label>
              TO
              <input
                type="date"
                min={trip.startDate}
                value={trip.endDate}
                onChange={(e) =>
                  updateTripDates(trip.startDate, e.target.value)
                }
              />
            </label>
          </div>
        </div>
        <div className="countdown-card">
          {tripCountdown ? (
            <>
              <span className="count-number">{tripCountdown.days}</span>
              <span className="count-label">DAYS TO GO</span>
              <small>
                {tripCountdown.hours}h {tripCountdown.minutes}m ·{" "}
                {localTimezone}
              </small>
            </>
          ) : tripStarted && !tripEnded ? (
            <>
              <span className="count-number">{activeIndex + 1 || "GO"}</span>
              <span className="count-label">ADVENTURE IN PROGRESS</span>
              <small>
                Today · {prettyDate(todayLocal)} · {localTimezone}
              </small>
            </>
          ) : tripEnded ? (
            <>
              <span className="count-number">✓</span>
              <span className="count-label">WHAT A JOURNEY</span>
              <small>Your memories are saved</small>
            </>
          ) : (
            <>
              <span className="count-number">—</span>
              <span className="count-label">CHOOSE YOUR DATES</span>
              <small>Your countdown starts here</small>
            </>
          )}
        </div>
      </section>

      <nav className="main-tabs">
        {[
          ["shopping", "shop", "Shopping"],
          ["schedule", "plan", "Schedule"],
          ["exchange", "exchange", "Exchange"],
          ["wheel", "wheel", "Who pays?"],
          ["notes", "note", "Notes"],
        ].map(([id, icon, label]) => (
          <button
            key={id}
            className={tab === id ? "active" : ""}
            onClick={() => setTab(id)}
          >
            <Icon name={icon} />
            <span>{label}</span>
          </button>
        ))}
      </nav>

      <section className="content-panel">
        {tab === "shopping" && (
          <Shopping
            key={tripId}
            tripId={tripId}
            trip={trip}
            setTrip={setTrip}
            text={shoppingText}
            setText={setShoppingText}
            add={addShopping}
            editing={editingShop}
            setEditing={setEditingShop}
          />
        )}
        {tab === "schedule" && (
          <Schedule
            setTrip={setTrip}
            trip={trip}
            dates={tripDates}
            updateDay={updateDay}
            showActive={showActive}
            activeDay={activeDay}
            activeIndex={activeIndex}
            planning={planning}
            setPlanning={setPlanning}
            nextCountdown={nextCountdown}
            ended={tripEnded}
          />
        )}
        {tab === "exchange" && <Exchange trip={trip} />}
        {tab === "wheel" && (
          <Wheel
            trip={trip}
            setTrip={setTrip}
            newTraveler={newTraveler}
            setNewTraveler={setNewTraveler}
            winner={winner}
            spinning={spinning}
            rotation={rotation}
            spin={spinWheel}
            dismissWinner={() => setWinner("")}
          />
        )}
        {tab === "notes" && <Notes trip={trip} setTrip={setTrip} />}
      </section>
      <footer>
        <span>BETTER TOGETHER</span> · A journey is better with company
      </footer>
        </>
      )}
      {shareOpen && (
        <div
          className="winner-modal share-modal"
          onClick={() => setShareOpen(false)}
        >
          <div onClick={(e) => e.stopPropagation()}>
            <button className="modal-close" onClick={() => setShareOpen(false)}>
              ×
            </button>
            <span className="share-symbol">DUO</span>
            <small>PLAN TOGETHER · TRAVEL TOGETHER</small>
            <h2>Invite a companion</h2>
            <p>
              People who join share this trip’s schedule, lists, wheel, and
              notes.
            </p>
            {invite ? (
              <div className="invite-code">
                <small>INVITATION CODE · EXPIRES IN 7 DAYS</small>
                <strong>{invite}</strong>
                <button onClick={() => navigator.clipboard?.writeText(invite)}>
                  Copy code
                </button>
              </div>
            ) : (
              <button className="spin-button" onClick={makeInvite}>
                Create invitation code
              </button>
            )}
            <p className="privacy-note">
              Only members of this trip can see its contents.
            </p>
          </div>
        </div>
      )}
      {profileOpen && (
        <PasswordModal
          user={account}
          onUserUpdate={(updates) => {
            const updatedUser = { ...account, ...updates };
            setAccount(updatedUser);
            setUser(updatedUser);
          }}
          onClose={() => setProfileOpen(false)}
          onLogout={() => {
            logout();
            nav("/", { replace: true });
          }}
        />
      )}
      {manageOpen && canManageUsers && (
        <AdminManager currentUser={account} onClose={() => setManageOpen(false)} />
      )}
    </main>
  );
}

function TripList({ trips, canCreate, onOpen, onCreate, onDelete }) {
  const [creating, setCreating] = useState(false);
  const [busy, setBusy] = useState("");
  const [error, setError] = useState("");
  const [form, setForm] = useState({
    tripName: "",
    country: "",
    city: "",
    startDate: "",
    endDate: "",
  });
  const today = localDate();
  const ownedTrips = trips.filter((item) => item.role === "owner");
  const invitedTrips = trips.filter((item) => item.role !== "owner");

  function statusFor(item) {
    if (tripIsCompleted(item, today)) return { label: "Completed", className: "completed" };
    if (item.startDate && item.endDate && today >= item.startDate && today <= item.endDate)
      return { label: "In progress", className: "active" };
    if (item.startDate && today < item.startDate)
      return { label: "Upcoming", className: "upcoming" };
    return { label: "Planning", className: "planning" };
  }

  async function open(id) {
    setBusy(`open-${id}`);
    setError("");
    try {
      await onOpen(id);
    } catch (requestError) {
      setError(requestError.message);
    } finally {
      setBusy("");
    }
  }

  async function submit(event) {
    event.preventDefault();
    setBusy("create");
    setError("");
    try {
      await onCreate(form);
      setForm({ tripName: "", country: "", city: "", startDate: "", endDate: "" });
      setCreating(false);
    } catch (requestError) {
      setError(requestError.message);
    } finally {
      setBusy("");
    }
  }

  async function removeTrip(item) {
    if (!window.confirm(`Delete ${item.tripName}? This permanently removes the trip for every traveler.`)) return;
    setBusy(`delete-trip-${item.id}`);
    setError("");
    try {
      await onDelete(item.id);
    } catch (requestError) {
      setError(requestError.message || "Could not delete the trip.");
    } finally {
      setBusy("");
    }
  }

  function tripCards(items, allowDelete = false) {
    return items.map((item) => {
      const status = statusFor(item);
      return (
        <article className={`trip-card ${status.className}`} key={item.id}>
          <div className="trip-card-topline">
            <span>{[item.city, item.country].filter(Boolean).join(" · ") || "Destination pending"}</span>
            <div className="trip-card-status-actions">
              <b>{status.label}</b>
              {allowDelete && <button
                type="button"
                className="trip-delete-btn"
                disabled={busy === `delete-trip-${item.id}`}
                onClick={() => removeTrip(item)}
                aria-label={`Delete ${item.tripName}`}
                title="Delete trip"
              >
                <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M9 3h6l1 2h4v2H4V5h4l1-2Zm-2 6h10l-1 11H8L7 9Zm3 2v7h2v-7h-2Zm4 0v7h2v-7h-2Z" /></svg>
              </button>}
            </div>
          </div>
          <h2>{item.tripName}</h2>
          <p>
            {item.startDate && item.endDate
              ? `${prettyDate(item.startDate, { year: true })} — ${prettyDate(item.endDate, { year: true })}`
              : "Dates not set"}
          </p>
          <button disabled={busy === `open-${item.id}`} onClick={() => open(item.id)}>
            {status.className === "completed" ? "View memories" : "Open trip"} <span>→</span>
          </button>
        </article>
      );
    });
  }

  return (
    <section className="trip-library">
      <div className="trip-library-heading">
        <div>
          <span>YOUR JOURNEYS · SHARED MEMORIES</span>
          <h1>Trip list</h1>
          <p>Open an upcoming journey or revisit a completed one.</p>
        </div>
        {canCreate && (
          <button className="primary-btn" onClick={() => setCreating((value) => !value)}>
            {creating ? "Cancel" : "＋ New trip"}
          </button>
        )}
      </div>

      {creating && (
        <form className="new-trip-form" onSubmit={submit}>
          <div className="new-trip-intro">
            <span>NEW JOURNEY</span>
            <strong>Where are you going next?</strong>
          </div>
          <label>
            TRIP NAME <small>OPTIONAL</small>
            <input
              value={form.tripName}
              onChange={(event) => setForm({ ...form, tripName: event.target.value })}
              placeholder="e.g. Summer in Paris"
            />
          </label>
          <label>
            COUNTRY
            <input
              value={form.country}
              onChange={(event) => setForm({ ...form, country: event.target.value })}
              placeholder="Country"
              required
            />
          </label>
          <label>
            CITY
            <input
              value={form.city}
              onChange={(event) => setForm({ ...form, city: event.target.value })}
              placeholder="City"
              required
            />
          </label>
          <label>
            FROM
            <input
              type="date"
              value={form.startDate}
              onChange={(event) => setForm({ ...form, startDate: event.target.value })}
              required
            />
          </label>
          <label>
            TO
            <input
              type="date"
              min={form.startDate}
              value={form.endDate}
              onChange={(event) => setForm({ ...form, endDate: event.target.value })}
              required
            />
          </label>
          <button disabled={busy === "create"}>
            {busy === "create" ? "Creating…" : "Create trip →"}
          </button>
        </form>
      )}

      {error && <div className="trip-library-error">{error}</div>}

      {ownedTrips.length > 0 && (
        <section className="trip-list-section">
          <div className="trip-list-section-title">
            <div><span>OWNER</span><h2>Trips you own</h2></div>
            <strong>{ownedTrips.length}</strong>
          </div>
          <div className="trip-card-grid">{tripCards(ownedTrips, true)}</div>
        </section>
      )}

      {invitedTrips.length > 0 && (
        <section className="trip-list-section invited-trip-section">
          <div className="trip-list-section-title">
            <div><span>SHARED WITH YOU</span><h2>Invited trips</h2></div>
            <strong>{invitedTrips.length}</strong>
          </div>
          <div className="trip-card-grid">{tripCards(invitedTrips)}</div>
        </section>
      )}

      {!trips.length && (
        <div className="trip-card-grid">
          <div className="trip-library-empty">
            <span>TT</span>
            <h2>No trips yet</h2>
            <p>{canCreate ? "Create your first journey to begin planning." : "A group owner can create the first journey."}</p>
          </div>
        </div>
      )}
    </section>
  );
}

function PasswordModal({ user, onClose, onLogout, onUserUpdate }) {
  const [currentPassword, setCurrentPassword] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [status, setStatus] = useState({ type: "", text: "" });
  const [saving, setSaving] = useState(false);
  const [avatarSaving, setAvatarSaving] = useState(false);

  async function changeAvatar(event) {
    const file = event.target.files?.[0];
    event.target.value = "";
    if (!file) return;
    if (!file.type.startsWith("image/") || file.size > 8 * 1024 * 1024) {
      setStatus({ type: "error", text: "Choose an image smaller than 8 MB." });
      return;
    }
    setAvatarSaving(true);
    setStatus({ type: "", text: "" });
    try {
      const avatarUrl = await resizeAvatar(file);
      await updateAvatar(avatarUrl);
      onUserUpdate({ avatarUrl });
      setStatus({ type: "success", text: "Profile photo updated." });
    } catch (error) {
      setStatus({ type: "error", text: error.message || "Could not update the photo." });
    } finally {
      setAvatarSaving(false);
    }
  }

  async function submit(event) {
    event.preventDefault();
    setStatus({ type: "", text: "" });
    if (newPassword !== confirmPassword) {
      setStatus({ type: "error", text: "The new passwords do not match." });
      return;
    }
    setSaving(true);
    try {
      await changePassword(currentPassword, newPassword, confirmPassword);
      setCurrentPassword("");
      setNewPassword("");
      setConfirmPassword("");
      setStatus({ type: "success", text: "Password updated successfully." });
    } catch (error) {
      setStatus({
        type: "error",
        text: error.message || "Could not update your password.",
      });
    } finally {
      setSaving(false);
    }
  }

  return (
    <div
      className="account-overlay"
      role="presentation"
      onMouseDown={(event) => event.target === event.currentTarget && onClose()}
    >
      <section
        className="account-modal"
        role="dialog"
        aria-modal="true"
        aria-labelledby="account-title"
      >
        <header>
          <div className="account-person">
            <label className={`avatar-upload ${avatarSaving ? "saving" : ""}`} title="Upload profile photo">
              <span className="avatar-image-frame">
                {user?.avatarUrl ? (
                  <img src={user.avatarUrl} alt="" />
                ) : (
                  (user?.name || "T")[0].toUpperCase()
                )}
              </span>
              <input
                type="file"
                accept="image/png,image/jpeg,image/webp"
                onChange={changeAvatar}
                disabled={avatarSaving}
                aria-label="Change profile photo"
              />
              <span className="avatar-edit-badge" aria-hidden="true">
                {avatarSaving ? (
                  <i className="avatar-spinner" />
                ) : (
                  <svg viewBox="0 0 24 24" focusable="false">
                    <path d="M9 4.5 10.4 3h3.2L15 4.5h2.75A2.25 2.25 0 0 1 20 6.75v9A2.25 2.25 0 0 1 17.75 18H6.25A2.25 2.25 0 0 1 4 15.75v-9A2.25 2.25 0 0 1 6.25 4.5H9Zm3 3A4.25 4.25 0 1 0 12 16a4.25 4.25 0 0 0 0-8.5Zm0 1.75A2.5 2.5 0 1 1 12 14.25a2.5 2.5 0 0 1 0-5Z" />
                  </svg>
                )}
              </span>
            </label>
            <div>
              <small>TRAVELER ACCOUNT · PRIVATE PROFILE</small>
              <strong>{user?.name}</strong>
            </div>
          </div>
          <button
            className="account-close"
            onClick={onClose}
            aria-label="Close account window"
          >
            ×
          </button>
        </header>
        <div className="account-body">
          <span className="profile-eyebrow">ACCOUNT SECURITY</span>
          <h2 id="account-title">Change your password</h2>
          <p>Enter your current password before choosing a new one.</p>
          <form className="password-form" onSubmit={submit}>
            <label>
              CURRENT PASSWORD
              <input
                type="password"
                autoComplete="current-password"
                value={currentPassword}
                onChange={(event) => setCurrentPassword(event.target.value)}
                required
              />
            </label>
            <div className="password-pair">
              <label>
                NEW PASSWORD
                <input
                  type="password"
                  autoComplete="new-password"
                  value={newPassword}
                  onChange={(event) => setNewPassword(event.target.value)}
                  required
                />
              </label>
              <label>
                CONFIRM NEW PASSWORD
                <input
                  type="password"
                  autoComplete="new-password"
                  value={confirmPassword}
                  onChange={(event) => setConfirmPassword(event.target.value)}
                  required
                />
              </label>
            </div>
            <small className="password-rule">
              Use at least 6 characters with a letter and a number.
            </small>
            {status.text && (
              <div className={`profile-alert ${status.type}`}>
                {status.type === "success" ? "✓ " : ""}
                {status.text}
              </div>
            )}
            <button className="password-submit" disabled={saving}>
              {saving ? "Updating…" : "Update password"}
            </button>
          </form>
        </div>
        <footer className="account-footer">
          <button className="back-to-trip" onClick={onClose}>
            ← Back to trip
          </button>
          <button className="modal-logout" onClick={onLogout}>
            Log out <span>↗</span>
          </button>
        </footer>
      </section>
    </div>
  );
}

function SectionTitle({ eyebrow, title, text, action }) {
  return (
    <div className="section-heading">
      <div>
        <span>{eyebrow}</span>
        <h2>{title}</h2>
        <p>{text}</p>
      </div>
      {action}
    </div>
  );
}

function Exchange({ trip }) {
  const initialCurrency = SHOPPING_CURRENCIES.some(
    ([code]) => code === trip.shoppingCurrency,
  )
    ? trip.shoppingCurrency
    : "JPY";
  const [amount, setAmount] = useState("1570");
  const [from, setFrom] = useState(initialCurrency);
  const [to, setTo] = useState(initialCurrency === "CAD" ? "USD" : "CAD");
  const [rate, setRate] = useState(null);
  const [rateDate, setRateDate] = useState("");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [refreshKey, setRefreshKey] = useState(0);

  useEffect(() => {
    let active = true;
    setLoading(true);
    setError("");
    loadExchangeRate(from, to)
      .then((data) => {
        if (!active) return;
        setRate(Number(data.rate));
        setRateDate(data.date || "");
      })
      .catch((requestError) => {
        if (!active) return;
        setRate(null);
        setRateDate("");
        setError(requestError.message);
      })
      .finally(() => {
        if (active) setLoading(false);
      });
    return () => {
      active = false;
    };
  }, [from, to, refreshKey]);

  const numericAmount = Number(amount);
  const converted = Number.isFinite(numericAmount) && rate
    ? numericAmount * rate
    : null;
  const formattedResult = converted === null
    ? "—"
    : new Intl.NumberFormat(undefined, {
        style: "currency",
        currency: to,
        maximumFractionDigits: 4,
      }).format(converted);
  const displayedRate = rate
    ? new Intl.NumberFormat(undefined, { maximumSignificantDigits: 8 }).format(rate)
    : "—";
  const reverseRate = rate
    ? new Intl.NumberFormat(undefined, { maximumSignificantDigits: 8 }).format(1 / rate)
    : "—";

  return (
    <>
      <SectionTitle
        eyebrow="LATEST REFERENCE RATE · CURRENCY"
        title="Exchange"
        text="Convert travel money using the latest published exchange rate."
      />
      <div className="exchange-card">
        <div className="exchange-inputs">
          <label className="exchange-amount">
            <span>AMOUNT</span>
            <input
              type="number"
              min="0"
              step="any"
              inputMode="decimal"
              value={amount}
              onChange={(event) => setAmount(event.target.value)}
              aria-label={`Amount in ${from}`}
            />
          </label>
          <CurrencyPicker value={from} onChange={setFrom} label="FROM" />
          <button
            type="button"
            className="exchange-swap"
            onClick={() => {
              setFrom(to);
              setTo(from);
            }}
            aria-label="Swap currencies"
            title="Swap currencies"
          >
            ⇄
          </button>
          <CurrencyPicker value={to} onChange={setTo} label="TO" />
        </div>

        <div className={`exchange-result ${loading ? "loading" : ""}`} aria-live="polite">
          <span>{amount || "0"} {from}</span>
          <strong>{loading ? "Updating…" : formattedResult}</strong>
          {!loading && !error && (
            <small>1 {from} = {displayedRate} {to} · 1 {to} = {reverseRate} {from}</small>
          )}
          {error && <small className="exchange-error">{error}</small>}
        </div>

        <div className="exchange-meta">
          <span>
            {rateDate ? `Rate published ${prettyDate(rateDate, { year: true })}` : "Latest rate unavailable"}
          </span>
          <button type="button" onClick={() => setRefreshKey((key) => key + 1)} disabled={loading}>
            Refresh rate
          </button>
        </div>
        <p className="exchange-disclaimer">
          Indicative reference rate from <a href="https://frankfurter.dev/" target="_blank" rel="noreferrer">Frankfurter</a>. Your bank or card provider may use a different rate and add fees.
        </p>
      </div>
    </>
  );
}

function Shopping({ tripId, trip, setTrip, text, setText, editing, setEditing }) {
  const [photos, setPhotos] = useState({});
  const [pendingPhoto, setPendingPhoto] = useState(null);
  useEffect(() => () => { if (pendingPhoto) URL.revokeObjectURL(pendingPhoto.url); }, [pendingPhoto]);
  const [busy, setBusy] = useState(false);
  const [photoError, setPhotoError] = useState("");
  const [viewer, setViewer] = useState(null);
  const dialog = useRef(null);
  const photoIds = trip.shopping.map(item => item.photoId || "").join(",");
  useEffect(() => {
    let alive = true;
    async function refreshPhotos() {
      try {
        const { photos } = await loadShoppingPhotos(tripId);
        if (alive) setPhotos(Object.fromEntries(photos.map(photo => [photo.id, photo.url])));
      } catch (error) { if (alive) setPhotoError(error.message); }
    }
    refreshPhotos();
    const refreshTimer = setInterval(refreshPhotos, 45 * 60 * 1000);
    const onVisible = () => { if (document.visibilityState === "visible") refreshPhotos(); };
    document.addEventListener("visibilitychange", onVisible);
    return () => {
      alive = false;
      clearInterval(refreshTimer);
      document.removeEventListener("visibilitychange", onVisible);
    };
  }, [tripId, photoIds]);
  useEffect(() => { if (viewer) dialog.current?.showModal(); }, [viewer]);
  async function uploadPhoto(event, itemId = null) {
    const file = event.target.files?.[0];
    event.target.value = "";
    if (!file) return;
    if (file.size > 10 * 1024 * 1024) { setPhotoError("Images must be 10 MB or smaller."); return; }
    if (!itemId) {
      setPendingPhoto({ file, url: URL.createObjectURL(file) });
      setPhotoError("");
      return;
    }
    setBusy(true);
    setPhotoError("");
    try {
      const item = trip.shopping.find(item => item.id === itemId);
      if (!item) return;
      const { photo } = await uploadShoppingPhoto(tripId, file, item);
      setPhotos(current => ({ ...current, [photo.id]: photo.url }));
      update(itemId, { photoId: photo.id });
    } catch (error) { setPhotoError(error.message); }
    finally { setBusy(false); }
  }
  async function submitPhotoItem(event) {
    event.preventDefault();
    if (busy || !text.trim()) return;
    const item = { id: makeId(), text: text.trim(), checked: false, price: 0 };
    setBusy(true);
    setPhotoError("");
    try {
      if (pendingPhoto) {
        const { photo } = await uploadShoppingPhoto(tripId, pendingPhoto.file, item, true);
        item.photoId = photo.id;
        setPhotos(current => ({ ...current, [photo.id]: photo.url }));
      }
      setTrip(current => ({ ...current, shopping: [...current.shopping, item] }));
      setText("");
      setPendingPhoto(null);
    } catch (error) { setPhotoError(error.message); }
    finally { setBusy(false); }
  }
  const packed = trip.shopping.filter((item) => item.checked).length;
  const currency = SHOPPING_CURRENCIES.some(([code]) => code === trip.shoppingCurrency)
    ? trip.shoppingCurrency
    : "CAD";
  const budget = Number(trip.shoppingBudget) || 0;
  const spent = trip.shopping.reduce(
    (total, item) => total + (item.checked ? Number(item.price) || 0 : 0),
    0,
  );
  const remaining = budget - spent;
  const money = (value) => new Intl.NumberFormat(undefined, {
    style: "currency",
    currency,
    maximumFractionDigits: 2,
  }).format(value);
  const currencySymbol = new Intl.NumberFormat(undefined, {
    style: "currency",
    currency,
    currencyDisplay: "narrowSymbol",
  }).formatToParts(0).find((part) => part.type === "currency")?.value || currency;
  const update = (id, values) =>
    setTrip((current) => ({
      ...current,
      shopping: current.shopping.map((item) =>
        item.id === id ? { ...item, ...values } : item,
      ),
    }));
  async function remove(id) {
    if (busy) return;
    setBusy(true);
    setPhotoError("");
    try {
      const item = trip.shopping.find(item => item.id === id);
      await deleteShoppingItem(tripId, id, item?.photoId);
      setTrip(current => ({ ...current, shopping: current.shopping.filter(item => item.id !== id) }));
    } catch (error) { setPhotoError(`Could not delete item: ${error.message}`); }
    finally { setBusy(false); }
  }
  return (
    <>
      <SectionTitle
        eyebrow="PLAN THE EXTRAS · SHOPPING"
        title="Shopping list"
        text="Plan purchases together and keep the trip budget visible."
      />
      <div className="shopping-budget">
        <CurrencyPicker
          value={currency}
          onChange={(code) => setTrip((current) => ({
            ...current,
            shoppingCurrency: code,
          }))}
        />
        <label>
          <span>TOTAL BUDGET</span>
          <span className="money-input"><b title={currency}>{currencySymbol}</b><input
            type="number"
            min="0"
            step="0.01"
            value={trip.shoppingBudget || ""}
            onChange={(event) => setTrip((current) => ({
              ...current,
              shoppingBudget: Math.max(0, Number(event.target.value) || 0),
            }))}
            placeholder="0.00"
            aria-label="Total shopping budget"
          /></span>
        </label>
        <div><span>SPENT</span><strong>{money(spent)}</strong></div>
        <div className={remaining < 0 ? "over-budget" : ""}>
          <span>{remaining < 0 ? "OVER BUDGET" : "REMAINING"}</span>
          <strong>{money(Math.abs(remaining))}</strong>
        </div>
      </div>
      <div className="progress-row">
        <div>
          <strong>{packed}</strong> of {trip.shopping.length} packed
        </div>
        <div className="progress">
          <i
            style={{
              width: `${trip.shopping.length ? (packed / trip.shopping.length) * 100 : 0}%`,
            }}
          />
        </div>
      </div>
      <form className="shopping-composer" onSubmit={submitPhotoItem}>
        <label className="composer-seal photo-upload" title="Upload an item photo">
          {pendingPhoto ? <img src={pendingPhoto.url} alt="Selected item" /> : <><span>+</span><small>{busy ? "UPLOADING..." : "UPLOAD PHOTO"}</small></>}
          <input type="file" accept="image/jpeg,image/png,image/webp,image/gif" disabled={busy} onChange={uploadPhoto} aria-label="Upload item photo" />
        </label>
        <label>
          <small>ADD A PURCHASE OR PACKING ITEM</small>
          <input
            disabled={busy}
            value={text}
            onChange={(e) => setText(e.target.value)}
            placeholder={`What do you need for ${trip.city || "your trip"}?`}
          />
        </label>
        <button disabled={busy || !text.trim()}>
          <span>Add item</span>
          <small>ADD TO LIST</small>
        </button>
      </form>
      {photoError && <p role="alert" className="photo-error">{photoError}</p>}
      <dialog ref={dialog} aria-label="Item photo" className="shopping-photo-viewer" onClose={() => setViewer(null)} onClick={event => { if (event.target === event.currentTarget) dialog.current.close(); }}>
        <button type="button" autoFocus className="modal-close" onClick={() => dialog.current.close()} aria-label="Close image">&#215;</button>
        {viewer && <>
          <header className="photo-viewer-header"><span>Item photo</span><h3>{viewer.text}</h3></header>
          <div className="photo-viewer-image"><img src={photos[viewer.id]} alt={viewer.text} /></div>
          <footer className="photo-viewer-footer">
          <label className="viewer-photo-replace shopping-photo-control" title="Upload replacement photo">
            <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 16V3m-5 5 5-5 5 5M4 15v5h16v-5" /></svg>
            <input type="file" accept="image/jpeg,image/png,image/webp,image/gif" disabled={busy} onChange={event => { const item = trip.shopping.find(item => item.photoId === viewer.id); if (item) { uploadPhoto(event, item.id); dialog.current.close(); } }} aria-label="Upload replacement photo" />
            <span>{busy ? "Uploading..." : "Replace photo"}</span>
          </label>
          </footer>
        </>}
      </dialog>
      <div className="clean-list">
        {trip.shopping.length ? (
          trip.shopping.map((item) => (
            <div
              className={`shopping-row ${item.checked ? "done" : ""}`}
              key={item.id}
            >
              <label className="round-check">
                <input
                  type="checkbox"
                  checked={item.checked}
                  onChange={(e) =>
                    update(item.id, { checked: e.target.checked })
                  }
                />
                <span>✓</span>
              </label>
              <div className="shopping-photo-cell">
                {item.photoId ? (
                  <button type="button" className="shopping-photo-control shopping-thumbnail" disabled={!photos[item.photoId]} onClick={() => setViewer({ id: item.photoId, text: item.text })} aria-label={`Enlarge photo of ${item.text}`} title="View photo">
                    {photos[item.photoId] && <img src={photos[item.photoId]} alt="" loading="lazy" />}
                  </button>
                ) : (
                  <label className="shopping-photo-control row-photo-upload" title="Upload photo">
                    <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 16V3m-5 5 5-5 5 5M4 15v5h16v-5" /></svg>
                    <input type="file" accept="image/jpeg,image/png,image/webp,image/gif" disabled={busy} onChange={event => uploadPhoto(event, item.id)} aria-label={`Upload photo for ${item.text}`} />
                  </label>
                )}
              </div>
              {editing === item.id ? (
                <input
                  className="inline-edit"
                  autoFocus
                  value={item.text}
                  onChange={(e) => update(item.id, { text: e.target.value })}
                  onBlur={() => setEditing(null)}
                  onKeyDown={(e) => e.key === "Enter" && setEditing(null)}
                />
              ) : (
                <button
                  className="item-text"
                  title={item.text}
                  onClick={() => setEditing(item.id)}
                >
                  {item.text}
                </button>
              )}
              <label className="item-price">
                <span title={currency}>{currencySymbol}</span>
                <input
                  type="number"
                  min="0"
                  step="0.01"
                  value={item.price || ""}
                  onChange={(event) => update(item.id, { price: Math.max(0, Number(event.target.value) || 0) })}
                  placeholder="Price"
                  aria-label={`Price for ${item.text}`}
                />
              </label>
              <button
                className="icon-btn"
                onClick={() => setEditing(item.id)}
                aria-label="Edit"
              >
                ✎
              </button>
              <button
                className="icon-btn danger"
                onClick={() => remove(item.id)}
                aria-label="Delete"
              >
                ×
              </button>
            </div>
          ))
        ) : (
          <Empty text="Your packing list is waiting." />
        )}
      </div>
    </>
  );
}

function Schedule({
  setTrip,
  trip,
  dates,
  updateDay,
  showActive,
  activeDay,
  activeIndex,
  planning,
  setPlanning,
  nextCountdown,
  ended,
}) {
  const allStops = trip.days.flatMap((day) => day.items);
  const visited = allStops.filter((item) => item.checked).length;
  if (!dates.length)
    return (
      <>
        <SectionTitle
          eyebrow="BUILD YOUR DAYS · ITINERARY"
          title="Schedule"
          text="Set the trip dates above and each day will appear here."
        />
        <Empty text="Choose a start and end date to begin planning." />
      </>
    );
  if (showActive)
    return (
      <ActiveDay
        day={activeDay}
        index={activeIndex}
        destination={trip.city || trip.country || "YOUR TRIP"}
        updateDay={updateDay}
        onPlan={() => setPlanning(true)}
      />
    );
  if (nextCountdown && !planning)
    return (
      <>
        <SectionTitle
          eyebrow="DAY COMPLETE · SHARED PROGRESS"
          title="Beautiful work today"
          text={`${activeDay.items.filter((i) => i.checked).length} visited · ${activeDay.items.filter((i) => !i.checked).length} missed`}
          action={
            <button className="outline-btn" onClick={() => setPlanning(true)}>
              View full plan
            </button>
          }
        />
        <div className="next-count">
          <span>Next adventure in</span>
          <strong>
            {nextCountdown.hours}h {nextCountdown.minutes}m
          </strong>
          <small>
            {prettyDate(trip.days.find((d) => d.date > activeDay.date)?.date, {
              weekday: true,
            })}
          </small>
        </div>
        <Missed
          day={activeDay}
          updateDay={updateDay}
          setPlanning={setPlanning}
        />
      </>
    );
  return (
    <>
      <SectionTitle
        eyebrow={ended ? "JOURNEY COMPLETE · MEMORIES" : "BUILD YOUR DAYS · ITINERARY"}
        title={
          ended ? "Your trip at a glance" : `${dates.length}-day itinerary`
        }
        text={
          ended
            ? `${visited} of ${allStops.length} places visited.`
            : `Shape each day, then let Trip Tools guide you in ${trip.city || "your destination"}.`
        }
        action={
          <div className="schedule-heading-actions">
            <ScheduleImport days={trip.days} onImport={stops => {
              appendImportedStops(trip.days, stops, makeId);
              setTrip(current => ({ ...current, days: appendImportedStops(current.days, stops, makeId) }));
            }} />
            {planning && <button className="primary-btn" onClick={() => setPlanning(false)}>Done editing &#10003;</button>}
          </div>
        }
      />
      <div className="day-stack">
        {trip.days.map((day, index) => (
          <DayEditor
            key={day.id}
            day={day}
            index={index}
            updateDay={updateDay}
          />
        ))}
      </div>
    </>
  );
}

function DayEditor({ day, index, updateDay }) {
  const [isCollapsed, setIsCollapsed] = useState(false);
  const [draggingStopId, setDraggingStopId] = useState(null);
  const [dropIndicator, setDropIndicator] = useState(null);
  const dragState = useRef({ sourceId: null, targetId: null, after: false });
  const editorId = `day-editor-${day.id}`;
  const addStop = () =>
    updateDay(day.id, (value) => ({
      ...value,
      items: [...value.items, emptyStop()],
    }));
  const updateStop = (id, values) =>
    updateDay(day.id, (value) => ({
      ...value,
      items: value.items.map((item) =>
        item.id === id ? { ...item, ...values } : item,
      ),
    }));
  const removeStop = (id) =>
    updateDay(day.id, (value) => ({
      ...value,
      items: value.items.filter((item) => item.id !== id),
    }));
  const resetDrag = () => {
    dragState.current = { sourceId: null, targetId: null, after: false };
    setDraggingStopId(null);
    setDropIndicator(null);
  };
  const setDropTarget = (targetId, after) => {
    if (!dragState.current.sourceId || targetId === dragState.current.sourceId) {
      dragState.current.targetId = null;
      setDropIndicator(null);
      return;
    }
    if (dragState.current.targetId === targetId && dragState.current.after === after) return;
    dragState.current.targetId = targetId;
    dragState.current.after = after;
    setDropIndicator({ id: targetId, after });
  };
  const reorderStop = (sourceId, targetId, after) =>
    updateDay(day.id, (value) => {
      const items = reorderScheduleItems(value.items, sourceId, targetId, after);
      if (items === value.items) return value;
      return { ...value, items };
    });
  const finishDrag = () => {
    const { sourceId, targetId, after } = dragState.current;
    if (sourceId && targetId) reorderStop(sourceId, targetId, after);
    resetDrag();
  };
  const beginDesktopDrag = (event, sourceId) => {
    dragState.current = { sourceId, targetId: null, after: false };
    setDraggingStopId(sourceId);
    event.dataTransfer.effectAllowed = "move";
    event.dataTransfer.setData("text/plain", sourceId);
  };
  const updateDropTarget = (row, pointerY, targetId) => {
    const bounds = row.getBoundingClientRect();
    setDropTarget(targetId, pointerY >= bounds.top + bounds.height / 2);
  };
  const beginPointerDrag = (event, sourceId) => {
    if (event.pointerType === "mouse") return;
    event.preventDefault();
    event.currentTarget.setPointerCapture(event.pointerId);
    dragState.current = { sourceId, targetId: null, after: false };
    setDraggingStopId(sourceId);
  };
  const continuePointerDrag = (event) => {
    if (!dragState.current.sourceId || event.pointerType === "mouse") return;
    event.preventDefault();
    if (event.clientY < 72) window.scrollBy({ top: -12 });
    if (event.clientY > window.innerHeight - 72) window.scrollBy({ top: 12 });
    const row = document.elementFromPoint(event.clientX, event.clientY)?.closest(".stop-editor");
    if (row?.dataset.stopId) updateDropTarget(row, event.clientY, row.dataset.stopId);
  };
  const reorderWithKeyboard = (event, itemId) => {
    if (event.key !== "ArrowUp" && event.key !== "ArrowDown") return;
    event.preventDefault();
    updateDay(day.id, (value) => {
      const sourceIndex = value.items.findIndex((item) => item.id === itemId);
      const targetIndex = sourceIndex + (event.key === "ArrowUp" ? -1 : 1);
      if (sourceIndex < 0 || targetIndex < 0 || targetIndex >= value.items.length) return value;
      const items = reorderScheduleItems(
        value.items,
        itemId,
        value.items[targetIndex].id,
        event.key === "ArrowDown",
      );
      if (items === value.items) return value;
      return { ...value, items };
    });
  };
  return (
    <article className="day-card">
      <div className="day-head">
        <div className="day-badge">
          DAY <strong>{index + 1}</strong>
        </div>
        <div className="day-head-copy">
          <h3>{prettyDate(day.date, { weekday: true })}</h3>
          <span>
            {day.items.length} {day.items.length === 1 ? "place" : "places"}
          </span>
        </div>
        <div className="day-head-actions">
          {day.completed && <b className="complete-pill">COMPLETED</b>}
          <button
            type="button"
            className="day-collapse"
            onClick={() => setIsCollapsed((collapsed) => !collapsed)}
            aria-expanded={!isCollapsed}
            aria-controls={editorId}
            aria-label={isCollapsed ? "Expand day" : "Minimize day"}
            title={isCollapsed ? "Expand day" : "Minimize day"}
          >
            <span aria-hidden="true">{isCollapsed ? "+" : "−"}</span>
          </button>
        </div>
      </div>
      <div id={editorId} hidden={isCollapsed}>
        <div className="stop-editor-list">
          {day.items.map((item, itemIndex) => (
            <div
              className={`stop-editor ${draggingStopId === item.id ? "dragging" : ""} ${dropIndicator?.id === item.id ? (dropIndicator.after ? "drop-after" : "drop-before") : ""}`}
              key={item.id}
              data-stop-id={item.id}
              onDragOver={(event) => {
                if (!dragState.current.sourceId) return;
                event.preventDefault();
                event.dataTransfer.dropEffect = "move";
                updateDropTarget(event.currentTarget, event.clientY, item.id);
              }}
              onDrop={(event) => {
                event.preventDefault();
                finishDrag();
              }}
            >
            <button
              type="button"
              className="stop-drag-handle"
              draggable
              onDragStart={(event) => beginDesktopDrag(event, item.id)}
              onDragEnd={resetDrag}
              onPointerDown={(event) => beginPointerDrag(event, item.id)}
              onPointerMove={continuePointerDrag}
              onPointerUp={(event) => {
                if (event.pointerType !== "mouse" && dragState.current.sourceId) finishDrag();
              }}
              onPointerCancel={resetDrag}
              onKeyDown={(event) => reorderWithKeyboard(event, item.id)}
              aria-label={`Move place ${itemIndex + 1}. Drag to reorder, or use the up and down arrow keys.`}
              title="Drag to reorder"
            >
              <span className="stop-drag-grip" aria-hidden="true">⠿</span>
              <span className="stop-number" aria-hidden="true">
                {String(itemIndex + 1).padStart(2, "0")}
              </span>
            </button>
            <label>
              PLACE
              <input
                value={item.place}
                onChange={(e) => updateStop(item.id, { place: e.target.value })}
                placeholder="Senso-ji Temple"
              />
            </label>
            <label>
              TIME
              <input
                type="time"
                value={item.time}
                onChange={(e) => updateStop(item.id, { time: e.target.value })}
              />
            </label>
            <label>
              DURATION
              <input
                value={item.duration}
                onChange={(e) =>
                  updateStop(item.id, { duration: e.target.value })
                }
                placeholder="1 hr"
              />
            </label>
            <label className="address-field">
              ADDRESS
              <input
                value={item.note}
                onChange={(e) => updateStop(item.id, { note: e.target.value })}
                placeholder="Street address or map link"
              />
            </label>
            <button
              type="button"
              className="remove-stop"
              onClick={() => removeStop(item.id)}
              aria-label={`Remove place ${itemIndex + 1}`}
              title="Remove place"
            >
              <span aria-hidden="true">×</span>
            </button>
            </div>
          ))}
        </div>
        <button type="button" className="add-stop" onClick={addStop}>
          ＋ Add another place
        </button>
      </div>
    </article>
  );
}

function ActiveDay({ day, index, destination, updateDay, onPlan }) {
  const done = day.items.filter((item) => item.checked).length;
  const toggle = (id, checked) =>
    updateDay(day.id, (value) => ({
      ...value,
      items: value.items.map((item) =>
        item.id === id ? { ...item, checked } : item,
      ),
    }));
  return (
    <>
      <SectionTitle
        eyebrow={`TODAY IN ${destination.toUpperCase()} · LIVE PLAN`}
        title={`Day ${index + 1} · ${prettyDate(day.date, { weekday: true })}`}
        text={`${done} of ${day.items.length} locations visited. Check them off as you go.`}
        action={
          <button className="outline-btn" onClick={onPlan}>
            Full itinerary
          </button>
        }
      />
      <div className="active-progress">
        <i
          style={{
            width: `${day.items.length ? (done / day.items.length) * 100 : 0}%`,
          }}
        />
      </div>
      <div className="timeline">
        {day.items.map((item, i) => (
          <label
            className={`timeline-stop ${item.checked ? "done" : ""}`}
            key={item.id}
          >
            <input
              type="checkbox"
              checked={item.checked}
              onChange={(e) => toggle(item.id, e.target.checked)}
            />
            <span className="timeline-mark">{item.checked ? "✓" : i + 1}</span>
            <time>{item.time || "Any time"}</time>
            <div>
              <strong>{item.place || "Untitled place"}</strong>
              <small>
                {[item.duration, item.note].filter(Boolean).join(" · ") ||
                  "No details added"}
              </small>
            </div>
          </label>
        ))}
      </div>
      <button
        className="complete-day"
        onClick={() =>
          updateDay(day.id, (value) => ({ ...value, completed: true }))
        }
      >
        Complete Day {index + 1} <span>→</span>
      </button>
    </>
  );
}

function Missed({ day, updateDay, setPlanning }) {
  const missed = day.items.filter((item) => !item.checked);
  if (!missed.length) return null;
  return (
    <div className="missed">
      <h3>Places to reschedule</h3>
      {missed.map((item) => (
        <div key={item.id}>
          <span>{item.place || "Untitled place"}</span>
          <button
            onClick={() => {
              updateDay(day.id, (value) => ({ ...value, completed: false }));
              setPlanning(true);
            }}
          >
            Reschedule
          </button>
        </div>
      ))}
    </div>
  );
}

function Wheel({
  trip,
  setTrip,
  newTraveler,
  setNewTraveler,
  winner,
  spinning,
  rotation,
  spin,
  dismissWinner,
}) {
  const colors = [
    "#e54b36",
    "#f6bd42",
    "#174c5b",
    "#df7b8b",
    "#5d7545",
    "#de8e42",
  ];
  const segments = wheelSegments(trip.travelers);
  const wheelResults = trip.wheelResults || {};
  const totalResults = Object.values(wheelResults).reduce(
    (total, count) => total + (Number(count) || 0),
    0,
  );
  const gradient = segments.length
    ? `conic-gradient(${segments.map((segment, i) => `${colors[segment.travelerIndex % colors.length]} ${(i * 100) / segments.length}% ${((i + 1) * 100) / segments.length}%`).join(",")})`
    : "conic-gradient(#eee 0 100%)";
  const add = (e) => {
    e.preventDefault();
    if (!newTraveler.trim()) return;
    setTrip((current) => ({
      ...current,
      travelers: [
        ...current.travelers,
        { id: makeId(), name: newTraveler.trim(), parts: DEFAULT_WHEEL_PARTS },
      ],
    }));
    setNewTraveler("");
  };
  return (
    <>
      <SectionTitle
        eyebrow="LEAVE IT TO LUCK · FAIR PICK"
        title="Who’s paying?"
        text="Add everyone, spin the wheel, and let fate choose the generous one."
      />
      <div className="wheel-layout">
        <div className="wheel-wrap">
          <span className="pointer">▼</span>
          <div
            className="wheel"
            style={{
              background: gradient,
              transform: `rotate(${rotation}deg)`,
            }}
          >
            <div className="wheel-center">GO</div>
          </div>
        </div>
        <div className="player-panel">
          <h3>
            Travel party <span>{segments.length}</span>
          </h3>
          <small className="wheel-parts-summary">
            {trip.travelers.length} {trip.travelers.length === 1 ? "traveler" : "travelers"} · {segments.length} wheel {segments.length === 1 ? "part" : "parts"}
          </small>
          <form className="person-add" onSubmit={add}>
            <input
              value={newTraveler}
              onChange={(e) => setNewTraveler(e.target.value)}
              placeholder="Traveler name"
            />
            <button>＋</button>
          </form>
          <div className="people">
            {trip.travelers.map((person, i) => (
              <div key={person.id}>
                <i style={{ background: colors[i % colors.length] }} />
                <span className="traveler-name">{person.name}</span>
                <label className="parts-control">
                  <span>PARTS</span>
                  <input
                    type="number"
                    min="1"
                    max={MAX_WHEEL_PARTS}
                    value={wheelPartCount(person)}
                    onChange={(event) => {
                      const parts = Math.min(
                        MAX_WHEEL_PARTS,
                        Math.max(1, Number(event.target.value) || 1),
                      );
                      setTrip((current) => ({
                        ...current,
                        travelers: current.travelers.map((traveler) =>
                          traveler.id === person.id ? { ...traveler, parts } : traveler,
                        ),
                      }));
                    }}
                    aria-label={`Wheel parts for ${person.name}`}
                  />
                </label>
                <button
                  onClick={() =>
                    setTrip((current) => ({
                      ...current,
                      travelers: current.travelers.filter(
                        (p) => p.id !== person.id,
                      ),
                      wheelResults: Object.fromEntries(
                        Object.entries(current.wheelResults || {}).filter(
                          ([travelerId]) => travelerId !== person.id,
                        ),
                      ),
                    }))
                  }
                >
                  ×
                </button>
              </div>
            ))}
          </div>
          <div className="wheel-results">
            <div className="wheel-results-heading">
              <div>
                <span>RESULT TALLY</span>
                <strong>{totalResults} {totalResults === 1 ? "spin" : "spins"}</strong>
              </div>
              <button
                type="button"
                disabled={!totalResults}
                onClick={() => setTrip((current) => ({ ...current, wheelResults: {} }))}
              >
                Reset
              </button>
            </div>
            <div className="wheel-result-list">
              {trip.travelers.map((person, i) => (
                <div key={person.id}>
                  <i style={{ background: colors[i % colors.length] }} />
                  <span>{person.name}</span>
                  <strong>{wheelResults[person.id] || 0}</strong>
                </div>
              ))}
            </div>
          </div>
          <button
            className="spin-button"
            disabled={trip.travelers.length < 2 || spinning}
            onClick={spin}
          >
            {spinning ? "SPINNING…" : "SPIN THE WHEEL"}
          </button>
          <small className="wheel-hint">
            {trip.travelers.length < 2
              ? "Add at least two travelers to spin"
              : "More parts give a traveler a higher chance of being selected"}
          </small>
        </div>
      </div>
      {winner && (
        <div className="winner-modal">
          <div>
            <span>🎉</span>
            <small>CONGRATULATIONS!</small>
            <h2>{winner}</h2>
            <p>It’s your lucky day — you’re paying!</p>
            <button onClick={dismissWinner}>Keep spinning</button>
          </div>
        </div>
      )}
    </>
  );
}

function Notes({ trip, setTrip }) {
  return (
    <>
      <SectionTitle
        eyebrow="KEEP THE DETAILS · TRIP RECORD"
        title="Trip notes"
        text="Addresses, phrases, booking numbers, and every thought in between."
      />
      <div className="note-paper">
        <div className="paper-title">
          MEMOS <span>SHARED NOTES</span>
        </div>
        <textarea
          value={trip.notes}
          onChange={(e) => setTrip({ ...trip, notes: e.target.value })}
          placeholder={
            "Start writing…\n\nHotel address, reservation numbers, useful phrases, or anything else for the trip."
          }
        />
        <div className="note-meta">
          <span>{trip.notes.length.toLocaleString()} characters</span>
          <span>Autosaved</span>
        </div>
      </div>
    </>
  );
}

function AdminManager({ currentUser, onClose }) {
  const [overview, setOverview] = useState({ users: [], groups: [], isAdmin: false });
  const [name, setName] = useState("");
  const [password, setPassword] = useState("");
  const [resetAccount, setResetAccount] = useState(null);
  const [resetForm, setResetForm] = useState({ password: "", confirm: "" });
  const [message, setMessage] = useState("");
  const [busy, setBusy] = useState("");
  const [dragging, setDragging] = useState(null);
  const [dragTarget, setDragTarget] = useState(null);
  const [selectedUserId, setSelectedUserId] = useState(null);
  const [collapsedGroups, setCollapsedGroups] = useState(new Set());
  const [collapsedUsers, setCollapsedUsers] = useState(new Set());
  const collapseDefaultsSet = useRef(false);
  const refresh = () =>
    loadAdminOverview()
      .then(setOverview)
      .catch((error) => setMessage(error.message));
  useEffect(() => {
    refresh();
  }, []);

  useEffect(() => {
    if (collapseDefaultsSet.current || (!overview.groups.length && !overview.users.length)) return;
    const ownerIds = [...new Set([
      ...overview.groups.map((group) => group.owner_user_id),
      ...overview.users.filter((account) => account.role === "admin" || Number(account.owned_group_count) > 0).map((account) => account.id),
      ...overview.users.map((account) => account.invited_by_user_id).filter(Boolean),
    ])];
    setCollapsedGroups(new Set(ownerIds));
    setCollapsedUsers(new Set([...ownerIds, "all-owners", "own-invited"]));
    collapseDefaultsSet.current = true;
  }, [overview]);

  async function create(event) {
    event.preventDefault();
    setMessage("");
    setBusy("create");
    try {
      await createAdminUser(name, password);
      setName("");
      setPassword("");
      setMessage("User created as the owner of a new private group.");
      await refresh();
    } catch (error) {
      setMessage(error.message);
    } finally {
      setBusy("");
    }
  }

  async function reset(event) {
    event.preventDefault();
    if (!resetAccount) return;
    if (resetForm.password !== resetForm.confirm) {
      setMessage("The new passwords do not match.");
      return;
    }
    setMessage("");
    setBusy(`reset-${resetAccount.id}`);
    try {
      await resetUserPassword(resetAccount.id, resetForm.password);
      setMessage(`${resetAccount.name}'s password was updated.`);
      setResetAccount(null);
      setResetForm({ password: "", confirm: "" });
    } catch (error) {
      setMessage(error.message);
    } finally {
      setBusy("");
    }
  }

  async function addToGroup(account, groupId) {
    const target = overview.groups.find((group) => group.id === groupId);
    setBusy(`add-${account.id}-${groupId}`);
    setMessage("");
    try {
      await addUserToGroup(account.id, groupId);
      setMessage(`${account.name} can now access ${target?.name || "the trip"}.`);
      await refresh();
    } catch (error) {
      setMessage(error.message);
    } finally {
      setBusy("");
    }
  }

  async function removeFromGroup(account, groupId) {
    const target = overview.groups.find((group) => group.id === groupId);
    setBusy(`remove-${account.id}-${groupId}`);
    setMessage("");
    try {
      await removeUserFromGroup(account.id, groupId);
      setMessage(`${account.name} was removed from ${target?.name || "the trip"}.`);
      await refresh();
    } catch (error) {
      setMessage(error.message);
    } finally {
      setBusy("");
    }
  }

  function startDrag(event, userId, sourceGroupId = null, membershipRole = null) {
    const payload = { userId, sourceGroupId, membershipRole };
    setDragging(payload);
    event.dataTransfer.effectAllowed = "copyMove";
    event.dataTransfer.setData("application/json", JSON.stringify(payload));
    event.dataTransfer.setData("text/plain", String(userId));
  }

  async function dropIntoGroup(event, groupId) {
    event.preventDefault();
    let payload = dragging;
    try {
      payload = JSON.parse(event.dataTransfer.getData("application/json")) || payload;
    } catch {
      payload = { userId: Number(event.dataTransfer.getData("text/plain")) };
    }
    const userId = Number(payload?.userId);
    const account = overview.users.find((user) => user.id === userId);
    const target = overview.groups.find((group) => group.id === groupId);
    setDragging(null);
    setDragTarget(null);
    if (!account || target?.members.some((member) => member.id === userId)) return;
    await addToGroup(account, groupId);
  }

  async function tapIntoGroup(groupId) {
    if (!selectedUserId || busy) return;
    const account = overview.users.find((user) => user.id === selectedUserId);
    const target = overview.groups.find((group) => group.id === groupId);
    if (!account || !target) return;
    if (target.members.some((member) => member.id === selectedUserId)) {
      setMessage(`${account.name} already has access to ${target.name}.`);
      setSelectedUserId(null);
      return;
    }
    await addToGroup(account, groupId);
    setSelectedUserId(null);
  }

  async function dropToRemove(event) {
    event.preventDefault();
    let payload = dragging;
    try {
      payload = JSON.parse(event.dataTransfer.getData("application/json")) || payload;
    } catch {
      payload = null;
    }
    setDragging(null);
    setDragTarget(null);
    if (!payload?.sourceGroupId || payload.membershipRole === "owner") return;
    const account = overview.users.find((user) => user.id === Number(payload.userId));
    if (account) await removeFromGroup(account, Number(payload.sourceGroupId));
  }

  async function remove(account) {
    if (
      !window.confirm(
        `Delete ${account.name}? This removes their Trip Tools login and cannot be undone.`,
      )
    )
      return;
    setBusy(`delete-${account.id}`);
    setMessage("");
    try {
      await deleteAdminUser(account.id);
      setMessage(`${account.name} was deleted.`);
      await refresh();
    } catch (error) {
      setMessage(error.message);
    } finally {
      setBusy("");
    }
  }

  async function removeGroup(group) {
    if (!window.confirm(`Delete ${group.name}? This permanently removes the trip for every traveler.`)) return;
    setBusy(`delete-group-${group.id}`);
    setMessage("");
    try {
      await deleteTrip(group.id);
      setMessage(`${group.name} was deleted.`);
      await refresh();
    } catch (error) {
      setMessage(error.message || "Could not delete the trip.");
    } finally {
      setBusy("");
    }
  }

  const groupsByOwner = overview.groups.reduce((sections, group) => {
    const owner = group.members.find((member) => member.role === "owner");
    const ownerId = owner?.id ?? group.owner_user_id;
    const ownerName = owner?.name
      || overview.users.find((account) => account.id === ownerId)?.name
      || "Unknown owner";
    let section = sections.find((entry) => entry.ownerId === ownerId);
    if (!section) {
      section = { ownerId, ownerName, groups: [] };
      sections.push(section);
    }
    section.groups.push(group);
    return sections;
  }, []);

  const invitationOwnerIds = new Set(
    overview.users.map((account) => Number(account.invited_by_user_id)).filter(Boolean),
  );
  const hierarchySections = [...groupsByOwner];
  overview.users
    .filter((account) => account.role === "admin" || Number(account.owned_group_count) > 0 || invitationOwnerIds.has(Number(account.id)))
    .forEach((account) => {
      if (!hierarchySections.some((section) => Number(section.ownerId) === Number(account.id))) {
        hierarchySections.push({ ownerId: account.id, ownerName: account.name, groups: [] });
      }
    });
  const groupedUserIds = new Set();
  const userHierarchy = hierarchySections.map((ownerSection) => {
    const owner = overview.users.find((account) => account.id === ownerSection.ownerId);
    if (owner) groupedUserIds.add(owner.id);
    const invited = overview.users.filter((account) =>
      Number(account.invited_by_user_id) === Number(ownerSection.ownerId)
    );
    invited.forEach((account) => groupedUserIds.add(account.id));
    return { ...ownerSection, owner, invited };
  });
  const ungroupedUsers = overview.users.filter((account) => !groupedUserIds.has(account.id));
  const ownerAccounts = overview.users.filter((account) => Number(account.owned_group_count) > 0);
  const ownInvitedUsers = overview.users.filter((account) =>
    Number(account.invited_by_user_id) === Number(currentUser.id),
  );

  const toggleSet = (setter, id) => setter((current) => {
    const next = new Set(current);
    if (next.has(id)) next.delete(id); else next.add(id);
    return next;
  });

  const userRow = (account, invited = false) => (
    <article
      className={`managed-user draggable-user ${selectedUserId === account.id ? "selected-user" : ""} ${invited ? "invited-user-row" : ""} ${overview.isAdmin ? "" : "owner-user-row"}`}
      key={`${invited ? "invited" : "user"}-${account.id}`}
      draggable
      onDragStart={(event) => startDrag(event, account.id)}
      onDragEnd={() => { setDragging(null); setDragTarget(null); }}
      onClick={() => {
        setSelectedUserId((current) => current === account.id ? null : account.id);
        setCollapsedGroups(new Set());
      }}
      role="button"
      tabIndex="0"
      onKeyDown={(event) => {
        if (event.key === "Enter" || event.key === " ") {
          setSelectedUserId((current) => current === account.id ? null : account.id);
          setCollapsedGroups(new Set());
        }
      }}
      title="Drag this traveler, or tap to select and then tap a trip"
    >
      <div className="managed-identity">
        <i>{account.name[0].toUpperCase()}</i>
        <div>
          <b>{account.name}</b>
          <small>{invited ? "Invited traveler" : account.role === "admin" ? "Administrator" : `Owner of ${account.owned_group_count} trip${Number(account.owned_group_count) === 1 ? "" : "s"}`}</small>
        </div>
      </div>
      {overview.isAdmin && <div className="managed-actions">
        <button type="button" className="reset-password-btn" onClick={(event) => {
          event.stopPropagation();
          setResetAccount(account);
          setResetForm({ password: "", confirm: "" });
        }}>Reset password</button>
        {account.id !== currentUser.id ? (
          <button type="button" className="delete-user" disabled={busy === `delete-${account.id}`} onClick={(event) => { event.stopPropagation(); remove(account); }} aria-label={`Delete ${account.name}`} title={`Delete ${account.name}`}>
            <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M9 3h6l1 2h4v2H4V5h4l1-2Zm-2 6h10l-1 11H8L7 9Zm3 2v7h2v-7h-2Zm4 0v7h2v-7h-2Z" /></svg>
          </button>
        ) : <span className="delete-placeholder" aria-hidden="true" />}
      </div>}
    </article>
  );

  return (
    <div
      className="manager-overlay"
      onMouseDown={(event) => event.target === event.currentTarget && onClose()}
    >
      <section
        className="manager-modal"
        role="dialog"
        aria-modal="true"
        aria-labelledby="manager-title"
      >
        <header>
          <div>
            <small>{overview.isAdmin ? "ADMINISTRATION" : "TRIP OWNER"} · ACCESS MANAGEMENT</small>
            <h2 id="manager-title">Manage users & groups</h2>
            <p>Each group is one trip. A traveler can belong to several groups.</p>
          </div>
          <button onClick={onClose} aria-label="Close user manager">
            ×
          </button>
        </header>
        <div className="manager-content">
          {overview.isAdmin && <form className="manager-create" onSubmit={create}>
            <div>
              <span>CREATE A GROUP OWNER</span>
              <strong>New traveler</strong>
            </div>
            <label>
              USERNAME
              <input
                value={name}
                onChange={(event) => setName(event.target.value)}
                placeholder="Traveler name"
                required
              />
            </label>
            <label>
              TEMPORARY PASSWORD
              <input
                type="password"
                value={password}
                onChange={(event) => setPassword(event.target.value)}
                placeholder="Letters + numbers"
                required
              />
            </label>
            <button disabled={busy === "create"}>
              {busy === "create" ? "Creating…" : "Create user + group"}
            </button>
          </form>}
          {message && <div className="manager-message">{message}</div>}
          <section className="group-overview">
            <div className="manager-section-title">
              <span>PRIVATE GROUPS</span>
              <strong>{overview.groups.length}</strong>
            </div>
            <p className="drag-help">
              {selectedUserId
                ? `${overview.users.find((account) => account.id === selectedUserId)?.name || "Traveler"} selected — tap a trip below to add access.`
                : "Drag a traveler into a trip, or tap a traveler and then tap the destination trip."}
            </p>
            <div className={`owner-group-sections ${dragging ? "is-dragging" : ""}`}>
              {groupsByOwner.map((ownerSection) => (
                <section className="owner-group-section" key={ownerSection.ownerId}>
                  <button type="button" className="owner-group-heading" onClick={() => toggleSet(setCollapsedGroups, ownerSection.ownerId)} aria-expanded={!collapsedGroups.has(ownerSection.ownerId)}>
                    <div>
                      <i>{ownerSection.ownerName[0].toUpperCase()}</i>
                      <span><small>GROUP OWNER</small><strong>{ownerSection.ownerName}</strong></span>
                    </div>
                    <b>{ownerSection.groups.length} {ownerSection.groups.length === 1 ? "trip" : "trips"} <em>{collapsedGroups.has(ownerSection.ownerId) ? "+" : "−"}</em></b>
                  </button>
                  {!collapsedGroups.has(ownerSection.ownerId) && <div className="group-board">
                    {ownerSection.groups.map((group) => (
                      <div
                        className={`group-dropzone ${dragTarget === group.id ? "drag-over" : ""}`}
                        key={group.id}
                        onDragOver={(event) => {
                          event.preventDefault();
                          event.dataTransfer.dropEffect = "move";
                          setDragTarget(group.id);
                        }}
                        onDrop={(event) => dropIntoGroup(event, group.id)}
                        onClick={() => tapIntoGroup(group.id)}
                      >
                        <div className="dropzone-heading">
                          <div><b>{group.name}</b><small>PRIVATE TRIP GROUP</small></div>
                          <div className="group-heading-actions">
                            <span>{group.members.length}</span>
                            <button
                              type="button"
                              disabled={busy === `delete-group-${group.id}`}
                              onClick={(event) => { event.stopPropagation(); removeGroup(group); }}
                              aria-label={`Delete ${group.name}`}
                              title="Delete trip"
                            >
                              <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M9 3h6l1 2h4v2H4V5h4l1-2Zm-2 6h10l-1 11H8L7 9Zm3 2v7h2v-7h-2Zm4 0v7h2v-7h-2Z" /></svg>
                            </button>
                          </div>
                        </div>
                        <div className="member-drag-list">
                          {group.members.map((member) => (
                            <button
                              type="button"
                              draggable
                              className={`member-drag-chip ${dragging?.userId === member.id && dragging?.sourceGroupId === group.id ? "dragging" : ""}`}
                              key={`${group.id}-${member.id}`}
                              onDragStart={(event) => startDrag(event, member.id, group.id, member.role)}
                              onDragEnd={() => { setDragging(null); setDragTarget(null); }}
                              title={member.role === "owner" ? "Owner of this trip" : "Drag to the remove zone or another trip"}
                            >
                              <i>⠿</i><span>{member.name}</span>{member.role === "owner" && <b>OWNER</b>}
                            </button>
                          ))}
                          {!group.members.length && <span className="empty-dropzone">Drop a traveler here</span>}
                        </div>
                      </div>
                    ))}
                  </div>}
                </section>
              ))}
            </div>
            {dragging?.sourceGroupId && dragging.membershipRole !== "owner" && (
              <div
                className={`remove-member-dropzone ${dragTarget === "remove" ? "drag-over" : ""}`}
                onDragOver={(event) => { event.preventDefault(); event.dataTransfer.dropEffect = "move"; setDragTarget("remove"); }}
                onDrop={dropToRemove}
              >
                <strong>Remove from this trip</strong>
                <small>Drop here to remove only this group membership.</small>
              </div>
            )}
          </section>
          <section className="managed-users">
            {overview.isAdmin ? <>
              <div className="manager-section-title">
                <span>ALL USERS</span>
                <strong>{overview.users.length}</strong>
              </div>
              <div className="user-hierarchy">
              {userHierarchy.map((section) => section.owner && (
                <section className="owner-user-section" key={`owner-users-${section.ownerId}`}>
                  <div className="owner-user-line">
                    {userRow(section.owner)}
                    {section.invited.length > 0 && <button type="button" className="collapse-users-btn" onClick={() => toggleSet(setCollapsedUsers, section.ownerId)} aria-label={`${collapsedUsers.has(section.ownerId) ? "Show" : "Hide"} invited users`}>
                      {collapsedUsers.has(section.ownerId) ? "+" : "−"}
                    </button>}
                  </div>
                  {!collapsedUsers.has(section.ownerId) && section.invited.length > 0 && <div className="invited-users">
                    {section.invited.map((account) => userRow(account, true))}
                  </div>}
                </section>
              ))}
              {ungroupedUsers.map((account) => userRow(account))}
              </div>
            </> : <div className="owner-directory">
              <section>
                <button type="button" className="manager-section-title directory-toggle" onClick={() => toggleSet(setCollapsedUsers, "all-owners")} aria-expanded={!collapsedUsers.has("all-owners")}>
                  <span>ALL OWNERS</span><strong>{ownerAccounts.length}</strong>
                </button>
                {!collapsedUsers.has("all-owners") && <div className="user-hierarchy">
                  {ownerAccounts.map((account) => userRow(account))}
                </div>}
              </section>
              <section>
                <button type="button" className="manager-section-title directory-toggle" onClick={() => toggleSet(setCollapsedUsers, "own-invited")} aria-expanded={!collapsedUsers.has("own-invited")}>
                  <span>YOUR INVITED USERS</span><strong>{ownInvitedUsers.length}</strong>
                </button>
                {!collapsedUsers.has("own-invited") && <div className="user-hierarchy invited-users-list">
                  {ownInvitedUsers.length ? ownInvitedUsers.map((account) => userRow(account, true)) : <p className="empty-directory">No invited users yet.</p>}
                </div>}
              </section>
            </div>}
          </section>
          <p className="manager-footnote">
            ★ Owners manage only their own trips. Adding a traveler preserves all of their existing trip access.
          </p>
        </div>
      </section>
      {resetAccount && <div className="reset-modal-overlay" onMouseDown={(event) => event.target === event.currentTarget && setResetAccount(null)}>
        <form className="reset-modal" onSubmit={reset} role="dialog" aria-modal="true" aria-labelledby="reset-title">
          <button type="button" className="reset-modal-close" onClick={() => setResetAccount(null)} aria-label="Close">×</button>
          <small>ACCOUNT SECURITY</small>
          <h3 id="reset-title">Reset {resetAccount.name}&apos;s password</h3>
          <p>Use at least 6 characters with a letter and a number.</p>
          <label>NEW PASSWORD<input type="password" autoComplete="new-password" value={resetForm.password} onChange={(event) => setResetForm((current) => ({ ...current, password: event.target.value }))} required /></label>
          <label>CONFIRM PASSWORD<input type="password" autoComplete="new-password" value={resetForm.confirm} onChange={(event) => setResetForm((current) => ({ ...current, confirm: event.target.value }))} required /></label>
          <button className="reset-modal-submit" disabled={busy === `reset-${resetAccount.id}`}>{busy === `reset-${resetAccount.id}` ? "Updating…" : "Reset password"}</button>
        </form>
      </div>}
    </div>
  );
}

function Empty({ text }) {
  return (
    <div className="empty-state">
      <span>TOGETHER</span>
      <p>{text}</p>
    </div>
  );
}
