export function ManagerIcon({ name }: { name: 'arrow' | 'check' | 'message' | 'send' | 'bot' }) {
  const paths = {
    bot: 'M12 3v3M10 3h4M5 7h14v13H5V7ZM8 11h1M15 11h1M9 16h6M2 11v5M22 11v5',
    arrow: 'M8 5l7 7-7 7',
    check: 'm5 12 4 4L19 6',
    message: 'M5 4h14a2 2 0 0 1 2 2v10a2 2 0 0 1-2 2H9l-6 3V6a2 2 0 0 1 2-2Zm2 5h10M7 13h6',
    send: 'm21 3-7 18-4-7-7-4 18-7Zm0 0L10 14',
  };
  return <svg className="manager-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d={paths[name]} /></svg>;
}
