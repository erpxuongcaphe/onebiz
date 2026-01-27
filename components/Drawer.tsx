import React, { useEffect, useState } from 'react';
import { X } from 'lucide-react';

interface DrawerProps {
  isOpen: boolean;
  onClose: () => void;
  title: string;
  children: React.ReactNode;
}

const Drawer: React.FC<DrawerProps> = ({ isOpen, onClose, title, children }) => {
  const [visible, setVisible] = useState(false);

  useEffect(() => {
    if (isOpen) {
      setVisible(true);
      document.body.style.overflow = 'hidden';
    } else {
      const timer = setTimeout(() => setVisible(false), 300); // Match transition duration
      document.body.style.overflow = 'unset';
      return () => clearTimeout(timer);
    }
  }, [isOpen]);

  if (!visible && !isOpen) return null;

  return (
    <div className="fixed inset-0 z-50 overflow-hidden" aria-labelledby="slide-over-title" role="dialog" aria-modal="true">
      <div className="absolute inset-0 overflow-hidden">
        {/* Background Overlay */}
        <div 
          className={`absolute inset-0 bg-slate-900/40 backdrop-blur-sm transition-opacity duration-300 ease-in-out ${isOpen ? 'opacity-100' : 'opacity-0'}`} 
          onClick={onClose}
          aria-hidden="true"
        />

        <div className="pointer-events-none fixed inset-y-0 right-0 flex max-w-full pl-10">
          {/* Drawer Panel */}
          <div 
            className={`pointer-events-auto w-screen max-w-md transform transition duration-300 ease-in-out sm:duration-300 ${isOpen ? 'translate-x-0' : 'translate-x-full'}`}
          >
            <div className="flex h-full flex-col overflow-y-scroll bg-white dark:bg-slate-900 shadow-2xl border-l border-slate-100 dark:border-slate-800">
              <div className="flex items-center justify-between px-4 py-3 border-b border-slate-100 dark:border-slate-800 bg-white/80 dark:bg-slate-900/80 backdrop-blur sticky top-0 z-10">
                <h2 className="text-sm font-bold text-slate-900 dark:text-white" id="slide-over-title">
                  {title}
                </h2>
                <div className="ml-3 flex h-7 items-center">
                  <button
                    type="button"
                    className="rounded-md bg-transparent text-slate-400 hover:text-slate-500 focus:outline-none"
                    onClick={onClose}
                  >
                    <span className="sr-only">Close panel</span>
                    <X className="h-4 w-4" aria-hidden="true" />
                  </button>
                </div>
              </div>
              <div className="relative mt-4 flex-1 px-4 pb-4">
                {children}
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};

export default Drawer;