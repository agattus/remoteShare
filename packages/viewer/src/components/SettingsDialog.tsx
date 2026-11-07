import { useState } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { getServerUrl, getViewerName, isValidServerUrl, setServerUrl, setViewerName } from "@/lib/settings";

export function SettingsDialog({
  open,
  onOpenChange,
  onServerChanged,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onServerChanged: (url: string) => void;
}) {
  const [server, setServer] = useState(getServerUrl);
  const [name, setName] = useState(getViewerName);
  const valid = isValidServerUrl(server);

  const save = () => {
    if (!valid) return;
    const previous = getServerUrl();
    setServerUrl(server);
    setViewerName(name || getViewerName());
    if (previous !== getServerUrl()) onServerChanged(getServerUrl());
    toast.success("Settings saved");
    onOpenChange(false);
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Settings</DialogTitle>
          <DialogDescription>Both computers must use the same RemoteDesk server.</DialogDescription>
        </DialogHeader>
        <div className="space-y-4">
          <div className="space-y-2">
            <Label htmlFor="server-url">Server address</Label>
            <Input id="server-url" value={server} onChange={(e) => setServer(e.target.value)} placeholder="https://remote.example.com" aria-invalid={!valid} />
            {!valid && <p className="text-xs text-red-300">Enter a full http:// or https:// address.</p>}
          </div>
          <div className="space-y-2">
            <Label htmlFor="viewer-name">Your name on connection prompts</Label>
            <Input id="viewer-name" value={name} maxLength={64} onChange={(e) => setName(e.target.value)} />
          </div>
        </div>
        <DialogFooter>
          <Button variant="ghost" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button onClick={save} disabled={!valid}>
            Save
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
