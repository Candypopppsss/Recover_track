import {
  lazy,
  Suspense,
  useCallback,
  useEffect,
  useRef,
  useState,
} from "react";
import { Link, Navigate, useLocation, useNavigate } from "react-router-dom";
import {
  Activity,
  ArrowUpRight,
  Bell,
  CalendarDays,
  Check,
  ChevronRight,
  CircleHelp,
  LayoutDashboard,
  LogOut,
  Menu,
  Pill,
  Search,
  Settings as SettingsIcon,
  Stethoscope,
  Users,
  X,
} from "lucide-react";
import { api, ApiError, post } from "./api";
import { AppContext, initials, todayInZone, formatDate } from "./context";
import type { State } from "./types";
import { Brand, Empty, Modal, Spinner } from "./components/ui";
import PrescriptionModal from "./components/PrescriptionModal";
import Auth from "./pages/Auth";
import Landing from "./pages/Landing";
const Overview = lazy(() => import("./pages/Overview"));
const Schedule = lazy(() => import("./pages/Schedule"));
const Medications = lazy(() => import("./pages/Medications"));
const Insights = lazy(() => import("./pages/Insights"));
const CareTeam = lazy(() => import("./pages/CareTeam"));
const Settings = lazy(() => import("./pages/Settings"));
const PatientView = lazy(() => import("./pages/PatientView"));
const CommandCenter = lazy(() => import("./pages/CommandCenter"));
interface Toast {
  id: number;
  message: string;
  type: "success" | "error";
}
const workspacePaths = new Set([
  "/dashboard",
  "/schedule",
  "/medications",
  "/insights",
  "/care-team",
  "/settings",
  "/patient",
  "/command-center",
]);
const authPaths = new Set(["/signin", "/register", "/demo"]);

function destinationAfterSignIn(routeState: unknown) {
  const target =
    routeState && typeof routeState === "object" && "returnTo" in routeState
      ? routeState.returnTo
      : undefined;
  return typeof target === "string" &&
    workspacePaths.has(target.split(/[?#]/)[0])
    ? target
    : "/dashboard";
}

export default function App() {
  const location = useLocation();
  useEffect(() => {
    if (location.hash && location.hash !== "#access") {
      const target = document.getElementById(location.hash.slice(1));
      if (target) target.scrollIntoView({ block: "start" });
      else window.scrollTo(0, 0);
    } else window.scrollTo(0, 0);
    const page =
      location.pathname === "/"
        ? "Recovery, organized"
        : location.pathname === "/signin"
          ? "Sign in"
          : location.pathname === "/register"
            ? "Create account"
            : location.pathname === "/demo"
              ? "Explore the demo"
              : workspacePaths.has(location.pathname)
                ? "Your recovery workspace"
                : "Page not found";
    document.title = `${page} · RecoverTrack`;
  }, [location.pathname, location.hash]);

  if (location.pathname === "/") {
    // Old links must no longer jump directly to an embedded sign-in form.
    if (location.hash === "#access") return <Navigate to="/" replace />;
    return <Landing />;
  }
  if (authPaths.has(location.pathname) || workspacePaths.has(location.pathname))
    return <RecoveryWorkspace />;
  return (
    <main className="public-not-found">
      <Link to="/" aria-label="RecoverTrack home">
        <Brand />
      </Link>
      <span className="subtle-note">404</span>
      <h1>This page isn’t here.</h1>
      <p>Return to the website or open your recovery workspace.</p>
      <div>
        <Link className="button primary" to="/">
          Back to home
        </Link>
        <Link className="button secondary" to="/signin">
          Sign in
        </Link>
      </div>
    </main>
  );
}

function RecoveryWorkspace() {
  const [state, setState] = useState<State | null>(null);
  const [loading, setLoading] = useState(true);
  const [failure, setFailure] = useState("");
  const [retrying, setRetrying] = useState(false);
  const [prescription, setPrescription] = useState(false);
  const [notifications, setNotifications] = useState(false);
  const [mobile, setMobile] = useState(false);
  const [toasts, setToasts] = useState<Toast[]>([]);
  const navigate = useNavigate();
  const location = useLocation();
  const toastId = useRef(0);
  const refreshSequence = useRef(0);
  const mounted = useRef(true);
  const notify = useCallback(
    (message: string, type: "success" | "error" = "success") => {
      const id = ++toastId.current;
      setToasts((items) => [...items, { id, message, type }]);
      window.setTimeout(
        () => setToasts((items) => items.filter((t) => t.id !== id)),
        6000,
      );
    },
    [],
  );
  const refresh = useCallback(async (signal?: AbortSignal) => {
    const sequence = ++refreshSequence.current;
    let result: State;
    try {
      result = await api<State>("/state", { signal });
    } catch (error) {
      if (signal?.aborted || sequence !== refreshSequence.current) return;
      throw error;
    }
    if (signal?.aborted || sequence !== refreshSequence.current) return;
    setState({
      ...result,
      checkIns: result.checkIns ?? [],
      prescriptions: result.prescriptions ?? [],
      careTeam: result.careTeam ?? [],
      activity: result.activity ?? [],
      notifications: result.notifications ?? [],
    });
    setFailure("");
    setLoading(false);
  }, []);
  useEffect(() => {
    mounted.current = true;
    const controller = new AbortController();
    let active = true;
    refresh(controller.signal)
      .catch((err) => {
        if (active && !(err instanceof ApiError && err.status === 401))
          setFailure((err as Error).message);
      })
      .finally(() => {
        if (active) setLoading(false);
      });
    return () => {
      active = false;
      mounted.current = false;
      controller.abort();
      refreshSequence.current++;
    };
  }, [refresh]);
  useEffect(() => {
    if (!state) return;
    const timer = window.setInterval(
      () =>
        refresh().catch((err) => {
          if (
            err instanceof ApiError &&
            (err.status === 401 || err.status === 403)
          ) {
            setState(null);
            setFailure(
              err.status === 401
                ? "Your session has ended. Sign in to continue."
                : err.message,
            );
          } else setFailure((err as Error).message);
        }),
      30000,
    );
    return () => window.clearInterval(timer);
  }, [Boolean(state), refresh]);
  useEffect(() => {
    setMobile(false);
    window.scrollTo(0, 0);
  }, [location.pathname]);
  useEffect(() => {
    const key = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "k" && state) {
        e.preventDefault();
        navigate("/medications");
      }
    };
    window.addEventListener("keydown", key);
    return () => window.removeEventListener("keydown", key);
  }, [state, navigate]);
  const mutate = useCallback(
    async (action: () => Promise<unknown>, message?: string) => {
      try {
        await action();
        await refresh();
        if (message) notify(message);
        return true;
      } catch (err) {
        notify((err as Error).message, "error");
        return false;
      }
    },
    [refresh, notify],
  );
  async function logout() {
    try {
      await post("/auth/logout");
      // Leaving the workspace clears its state. Clearing it first would let
      // the protected-route redirect race with the requested public homepage.
      refreshSequence.current++;
      navigate("/", { replace: true });
    } catch (err) {
      notify((err as Error).message, "error");
    }
  }
  async function signedIn() {
    if (!mounted.current) return;
    await refresh();
    if (mounted.current)
      navigate(destinationAfterSignIn(location.state), { replace: true });
  }
  async function retryConnection() {
    setRetrying(true);
    try {
      await api("/health");
      await refresh();
    } catch (err) {
      if (err instanceof ApiError && err.status === 401) setFailure("");
      else setFailure((err as Error).message);
    } finally {
      setRetrying(false);
    }
  }
  const isAuthPage = authPaths.has(location.pathname);
  if (isAuthPage) {
    if (state)
      return <Navigate to={destinationAfterSignIn(location.state)} replace />;
    return (
      <Auth
        initialMode={
          location.pathname === "/register"
            ? "register"
            : location.pathname === "/demo"
              ? "demo"
              : "login"
        }
        onSuccess={signedIn}
        serviceError={failure}
        onRetry={retryConnection}
      />
    );
  }
  if (loading && !state)
    return (
      <div className="loading-page">
        <Brand />
        <Spinner label="Loading RecoverTrack" />
      </div>
    );
  if (!state)
    return (
      <Navigate
        to="/signin"
        replace
        state={{ returnTo: location.pathname + location.search }}
      />
    );
  const role = state.user.role;
  const isDoctor = role === "doctor";
  const isPatient = role === "patient";
  const unread = state.notifications.filter((n) => !n.read).length;
  const nav = [
    {
      path: "/dashboard",
      label: isPatient ? "Today" : "Overview",
      icon: LayoutDashboard,
    },
    { path: "/schedule", label: "Medication schedule", icon: CalendarDays },
    { path: "/medications", label: "Medications", icon: Pill },
    { path: "/insights", label: "Recovery insights", icon: Activity },
    { path: "/care-team", label: "Care team", icon: Users },
    ...(!isPatient
      ? [
          {
            path: "/command-center",
            label: "Clinical review",
            icon: Stethoscope,
          },
        ]
      : []),
  ];
  const current =
    nav.find((item) => item.path === location.pathname)?.label ||
    (location.pathname === "/settings"
      ? "Settings"
      : location.pathname === "/patient"
        ? "Patient view"
        : "Overview");
  function renderPage() {
    switch (location.pathname) {
      case "/dashboard":
        return isDoctor ? (
          <CommandCenter />
        ) : isPatient ? (
          <PatientView />
        ) : (
          <Overview />
        );
      case "/schedule":
        return <Schedule />;
      case "/medications":
        return <Medications />;
      case "/insights":
        return <Insights />;
      case "/care-team":
        return <CareTeam />;
      case "/settings":
        return <Settings />;
      case "/patient":
        return <PatientView />;
      case "/command-center":
        return isPatient ? (
          <Navigate to="/dashboard" replace />
        ) : (
          <CommandCenter />
        );
      default:
        return <Navigate to="/dashboard" replace />;
    }
  }
  return (
    <AppContext.Provider
      value={{
        state,
        refresh,
        notify,
        mutate,
        openPrescription: () => setPrescription(true),
      }}
    >
      <div className={`app-shell ${mobile ? "mobile-open" : ""}`}>
        <button
          className="mobile-backdrop"
          onClick={() => setMobile(false)}
          aria-label="Close navigation"
        />
        <aside className="sidebar">
          <Link
            className="brand-link"
            to="/dashboard"
            aria-label="RecoverTrack overview"
          >
            <Brand />
          </Link>
          <div className="sidebar-patient">
            <span className="avatar">
              {state.patient.initials || initials(state.patient.name)}
            </span>
            <div>
              <strong>{state.patient.name}</strong>
              <span>{state.patient.surgery || "Recovery at home"}</span>
            </div>
          </div>
          <nav className="nav-links" aria-label="Main navigation">
            {nav.map((item) => (
              <Link
                key={item.path}
                className={`nav-item ${location.pathname === item.path ? "active" : ""}`}
                to={item.path}
                aria-current={
                  location.pathname === item.path ? "page" : undefined
                }
              >
                <item.icon size={18} strokeWidth={1.75} />
                <span>{item.label}</span>
              </Link>
            ))}
          </nav>
          <div className="sidebar-bottom">
            <Link className="nav-item" to="/">
              <ArrowUpRight size={18} />
              Visit website
            </Link>
            <Link
              className={`nav-item ${location.pathname === "/settings" ? "active" : ""}`}
              to="/settings"
            >
              <SettingsIcon size={18} />
              Settings
            </Link>
            <button className="nav-item" onClick={logout}>
              <LogOut size={18} />
              Sign out
            </button>
            <div className="user-menu">
              <span className="avatar avatar-sm">
                {initials(state.user.name)}
              </span>
              <div>
                <strong>{state.user.name}</strong>
                <span>
                  {isDoctor ? "Clinician" : isPatient ? "Patient" : "Caregiver"}
                </span>
              </div>
            </div>
          </div>
        </aside>
        <div className="workspace">
          <header className="topbar">
            <div className="breadcrumb">
              <button
                className="icon-button mobile-toggle"
                onClick={() => setMobile(true)}
                aria-label="Open navigation"
              >
                <Menu size={21} />
              </button>
              <span className="breadcrumb-home">RecoverTrack</span>
              <ChevronRight size={13} />
              <strong>{current}</strong>
            </div>
            <div className="topbar-actions">
              <span className="topbar-date desktop-only">
                <CalendarDays size={14} />
                {formatDate(todayInZone(state.patient.timeZone), {
                  weekday: "short",
                  month: "short",
                  day: "numeric",
                })}
              </span>
              <button
                className="icon-button search-shortcut"
                onClick={() => navigate("/medications")}
                aria-label="Search medications"
              >
                <Search size={18} />
              </button>
              <span className="topbar-divider" />
              <button
                className="icon-button notification-button"
                aria-label={`Notifications${unread ? `, ${unread} unread` : ""}`}
                onClick={() => setNotifications(true)}
              >
                <Bell size={19} />
                {unread > 0 && <span className="notification-dot" />}
              </button>
              <button
                className="avatar avatar-sm topbar-avatar"
                aria-label="Open account settings"
                onClick={() => navigate("/settings")}
              >
                {initials(state.user.name)}
              </button>
            </div>
          </header>
          {failure && (
            <div className="workspace-connection-notice" role="alert">
              <span>
                Updates are paused. Your last loaded records are shown.
              </span>
              <button
                className="text-button"
                onClick={retryConnection}
                disabled={retrying}
              >
                {retrying ? "Checking connection…" : "Try again"}
              </button>
            </div>
          )}
          {state.demo && (
            <div className="demo-banner">
              <span>
                Demo <span className="demo-banner-separator">·</span> Fictional
                patient data
              </span>
              <span>
                {isDoctor
                  ? "Clinician view"
                  : isPatient
                    ? "Patient view"
                    : "Caregiver view"}
                {role === "caregiver" && (
                  <button
                    onClick={() =>
                      navigate(
                        location.pathname === "/patient"
                          ? "/dashboard"
                          : "/patient",
                      )
                    }
                  >
                    {location.pathname === "/patient"
                      ? "Caregiver overview"
                      : "Try patient view"}
                    <ArrowUpRight size={12} />
                  </button>
                )}
              </span>
            </div>
          )}
          <main className="page-content" id="main-content">
            <Suspense
              fallback={
                <div className="page-loading">
                  <Spinner label="Loading page" />
                </div>
              }
            >
              {renderPage()}
            </Suspense>
          </main>
        </div>
      </div>
      {prescription && role === "caregiver" && (
        <PrescriptionModal onClose={() => setPrescription(false)} />
      )}{" "}
      {notifications && (
        <Modal
          title="Notifications"
          subtitle="Dose reminders and missed check-ins."
          onClose={() => setNotifications(false)}
          footer={
            <>
              <span className="subtle-note">
                Notifications update while services are running.
              </span>
              <button
                className="button secondary"
                onClick={() =>
                  mutate(
                    () => post("/notifications/read"),
                    "All notifications marked as read.",
                  )
                }
                disabled={!unread}
              >
                <Check size={15} />
                Mark all read
              </button>
            </>
          }
        >
          {state.notifications.length ? (
            <div className="notifications-list">
              {[...state.notifications]
                .sort((a, b) => b.createdAt.localeCompare(a.createdAt))
                .map((n) => (
                  <button
                    className={`notification-row ${!n.read ? "unread" : ""}`}
                    key={n.id}
                    onClick={async () => {
                      await mutate(() =>
                        post("/notifications/read", { ids: [n.id] }),
                      );
                      setNotifications(false);
                      navigate("/schedule");
                    }}
                  >
                    <span
                      className={`activity-dot ${n.type === "missed" ? "amber" : "purple"}`}
                    >
                      <Bell size={15} />
                    </span>
                    <div>
                      <strong>{n.title}</strong>
                      <p>{n.message}</p>
                      <time>{formatDate(n.createdAt)}</time>
                    </div>
                    {!n.read && <span className="notification-unread-dot" />}
                  </button>
                ))}
            </div>
          ) : (
            <Empty
              title="No notifications"
              description="Dose reminders and missed check-in alerts will appear here."
            />
          )}
        </Modal>
      )}{" "}
      <div className="toast-stack" aria-live="polite">
        {toasts.map((toast) => (
          <div className={`toast ${toast.type}`} key={toast.id}>
            {toast.type === "success" ? (
              <Check size={18} />
            ) : (
              <CircleHelp size={18} />
            )}
            <span>{toast.message}</span>
            <button
              onClick={() =>
                setToasts((items) => items.filter((t) => t.id !== toast.id))
              }
              aria-label="Dismiss notification"
            >
              <X size={16} />
            </button>
          </div>
        ))}
      </div>
    </AppContext.Provider>
  );
}
