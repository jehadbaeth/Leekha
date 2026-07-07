export function InstallBanner({
  onInstall,
  onDismiss,
  rtl,
}: {
  onInstall: () => void;
  onDismiss: () => void;
  rtl: boolean;
}) {
  return (
    <div className="fixed bottom-0 inset-x-0 z-50 bg-emerald-900 border-t border-emerald-700 px-4 py-3 flex items-center gap-3 text-emerald-50">
      <span className="text-sm flex-1">{rtl ? 'ثبّت ليخة على شاشتك الرئيسية' : 'Install Leekha on your home screen'}</span>
      <button className="rounded-lg bg-amber-400 text-emerald-950 font-semibold text-sm px-3 py-1.5" onClick={onInstall}>
        {rtl ? 'تثبيت' : 'Install'}
      </button>
      <button className="text-emerald-300 text-sm px-2" onClick={onDismiss}>
        {rtl ? 'لاحقاً' : 'Later'}
      </button>
    </div>
  );
}
