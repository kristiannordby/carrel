# Carrel on your iPhone: checklist

Free. About 10 minutes. You need the PC and the iPhone side by side.

## On the PC

1. **Restart Carrel.** Close every Carrel window (right-click **Carrel** in the taskbar, then **Close window**; repeat until none are left). Then double-click the **Carrel** shortcut on your desktop.
2. **Install Tailscale.** Open https://tailscale.com/download/windows and click **Download Tailscale for Windows**. Run the file, click **Install**, then **Yes**.
3. **Sign in to Tailscale.** Click the Tailscale icon by the clock (bottom right; it may be under the **^** arrow), click **Log in**, and sign in with **Google** or **GitHub** in the browser that opens. Remember which one you used. Click **Connect** if asked.
4. **Share Carrel.** Open the **Carrel** folder (where you installed it), then **Phone setup**, and double-click **1. Share Carrel with my phone**.
   - If the black window shows a link and says HTTPS or Serve is not enabled: hold **Ctrl** and click the link, click **Enable** on the page that opens, then double-click **1. Share Carrel with my phone** again.
   - When it works, it shows an address like `https://your-pc.tail1a2b3c.ts.net`. Write it down (it is also copied). Press any key to close the window.

## On the iPhone

5. **Install Tailscale.** Open the **App Store**, search **Tailscale**, tap **Get**. Open it, tap **Log in**, and use the **same** Google or GitHub account as step 3. When asked to add a VPN configuration, tap **Allow**, then confirm with Face ID or your passcode.
6. **Open Carrel.** Open **Safari**, type the address from step 4 into the address bar, tap **Go**. Carrel opens.
7. **Put it on your home screen.** Tap the **Share** button (square with an arrow, at the bottom), scroll down, tap **Add to Home Screen**, keep **Open as Web App** on, tap **Add**.
8. **Use it.** Open **Carrel** from your home screen. It opens full screen like an app.

## Optional

9. **Start Carrel with Windows** (so the phone always has something to sync with): in **Phone setup**, double-click **2. Start Carrel when I sign in (optional)**.
10. **Keep the PC awake while it is plugged in:** **Start** > **Settings** > **System** > **Power & battery** > **Screen, sleep & hibernate timeouts** > set **When plugged in, put my device to sleep after** to **Never**.

## Good to know

- Your answers, flags and notes sync between the phone and the PC whenever Carrel is open on the PC and Tailscale is on (it reconnects on its own).
- With the PC off, the phone still runs your quizzes, flashcards and written problems, plus any slide you opened before. It syncs the next time it can reach the PC.
- Claude, Canvas, Outlook and new slides need the PC.
- Only devices signed in to your Tailscale account can open the address. To turn it off: double-click **Stop sharing with my phone**.
- If the phone says it cannot connect: check Tailscale shows **Connected** on the phone, and that Carrel is open on the PC (only one Carrel window).
