import { ShellFallback } from '@/components/layout/shell-fallback';
import { Alert } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { textRole } from '@/components/ui/typography';

/** A fresh document also recovers route chunks replaced by a deployment. */
export function RouteError() {
  return (
    <ShellFallback>
      <main id="main" className="grid min-h-[60vh] place-items-center p-[var(--page-section-gap)]">
        <Alert tone="warning" className="max-w-lg">
          <div className="grid gap-4">
            <h1 className={textRole('sectionTitle')}>This page could not be opened</h1>
            <p>Reload this page to try again.</p>
            <Button className="w-fit" onClick={() => window.location.reload()}>
              Reload page
            </Button>
          </div>
        </Alert>
      </main>
    </ShellFallback>
  );
}
