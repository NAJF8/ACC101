// Coalesce RTDB's initial and bursty value notifications into one dashboard
// calculation.  Keeping this independent from Firebase makes the lifecycle
// deterministic and regression-testable.
export const createDashboardRefreshScheduler = ({ load, onData, onError }) => {
  let active = true;
  let loading = false;
  let pending = false;

  const run = async () => {
    if (!active || loading || !pending) return;
    pending = false;
    loading = true;
    try {
      const data = await load();
      if (active) onData(data);
    } catch (error) {
      if (active) onError?.(error);
    } finally {
      loading = false;
      if (active && pending) void run();
    }
  };

  const schedule = () => {
    if (!active) return;
    pending = true;
    queueMicrotask(() => { void run(); });
  };

  return {
    schedule,
    dispose: () => { active = false; pending = false; },
  };
};
