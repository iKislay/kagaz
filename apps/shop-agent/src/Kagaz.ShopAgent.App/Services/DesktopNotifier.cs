using System.Drawing;
using System.Windows;
using Forms = System.Windows.Forms;

namespace Kagaz.ShopAgent.App.Services;

/// <summary>
/// Windows notifications for new orders, through a tray icon (Windows 10/11 show its balloon as a normal
/// notification). Clicking the notification brings the window to the front and raises
/// <see cref="Clicked"/> with the order id; double-clicking the tray icon just brings the window back.
/// Shown only while the window isn't the active one — otherwise the in-app toast is enough.
/// </summary>
public sealed class DesktopNotifier : IDisposable
{
    private readonly Forms.NotifyIcon _icon;
    private string? _lastOrderId;

    public DesktopNotifier()
    {
        _icon = new Forms.NotifyIcon
        {
            Icon = AppIcon(),
            Text = "Kaggaz Shop",
            Visible = true,
        };
        _icon.BalloonTipClicked += (_, _) =>
        {
            BringToFront();
            if (_lastOrderId is { } id) Clicked?.Invoke(id);
        };
        _icon.DoubleClick += (_, _) => BringToFront();
    }

    /// <summary>The operator clicked the notification for this order id (UI thread).</summary>
    public event Action<string>? Clicked;

    public void Show(string title, string text, string orderId)
    {
        if (Application.Current?.MainWindow is { IsActive: true }) return;
        _lastOrderId = orderId;
        _icon.ShowBalloonTip(10_000, title, text, Forms.ToolTipIcon.Info);
    }

    private static void BringToFront()
    {
        if (Application.Current?.MainWindow is not { } window) return;
        window.Show();
        if (window.WindowState == WindowState.Minimized) window.WindowState = WindowState.Normal;
        window.Activate();
    }

    private static Icon AppIcon()
    {
        try { return Environment.ProcessPath is { } exe ? Icon.ExtractAssociatedIcon(exe) ?? SystemIcons.Application : SystemIcons.Application; }
        catch (ArgumentException) { return SystemIcons.Application; }
    }

    public void Dispose()
    {
        _icon.Visible = false; // otherwise a dead icon lingers in the tray until hovered
        _icon.Dispose();
    }
}
