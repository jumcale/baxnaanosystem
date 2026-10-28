import React from 'react';

interface ErrorBoundaryState {
  hasError: boolean;
  errorMessage: string;
}

export class GlobalErrorBoundary extends React.Component<
  { children: React.ReactNode },
  ErrorBoundaryState
> {
  constructor(props: { children: React.ReactNode }) {
    super(props);
    this.state = { hasError: false, errorMessage: '' };
  }

  static getDerivedStateFromError(error: Error): ErrorBoundaryState {
    return { hasError: true, errorMessage: error.message };
  }

  componentDidCatch(error: Error, errorInfo: React.ErrorInfo): void {
    console.error('[Baxnaano ErrorBoundary]:', error, errorInfo);
  }

  render() {
    if (this.state.hasError) {
      return (
        <div className="min-h-screen bg-slate-900 text-white flex items-center justify-center p-6">
          <div className="bg-slate-800 border border-red-500/40 rounded-2xl p-6 max-w-md w-full space-y-4 text-center">
            <h1 className="text-xl font-bold text-red-400">
              Khalad ayaa dhacay / Application Error
            </h1>
            <p className="text-xs text-slate-300 font-mono">{this.state.errorMessage}</p>
            <button
              onClick={() => window.location.reload()}
              className="min-h-[46px] px-6 py-2.5 bg-emerald-600 rounded-xl font-bold text-sm"
            >
              Dib u kici / Reload Application
            </button>
          </div>
        </div>
      );
    }

    return this.props.children;
  }
}
