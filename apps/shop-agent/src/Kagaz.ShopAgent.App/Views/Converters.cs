using System.Globalization;
using System.Windows;
using System.Windows.Data;
using System.Windows.Media;
using Kagaz.ShopAgent.App.Services;

namespace Kagaz.ShopAgent.App.Views;

/// <summary>macOS system status colours (CLAUDE.md "Design language"); status only.</summary>
internal static class StatusBrushes
{
    public static readonly SolidColorBrush Green = Freeze(0x34, 0xC7, 0x59);
    public static readonly SolidColorBrush Orange = Freeze(0xFF, 0x95, 0x00);
    public static readonly SolidColorBrush Red = Freeze(0xFF, 0x3B, 0x30);
    public static readonly SolidColorBrush Accent = Freeze(0x00, 0x7A, 0xFF);
    public static readonly SolidColorBrush Secondary = Freeze(0x6E, 0x6E, 0x73);

    private static SolidColorBrush Freeze(byte r, byte g, byte b)
    {
        var brush = new SolidColorBrush(Color.FromRgb(r, g, b));
        brush.Freeze();
        return brush;
    }
}

public sealed class BoolToVisibilityConverter : IValueConverter
{
    public bool Invert { get; set; }

    public object Convert(object value, Type targetType, object parameter, CultureInfo culture)
        => (value is true) ^ Invert ? Visibility.Visible : Visibility.Collapsed;

    public object ConvertBack(object value, Type targetType, object parameter, CultureInfo culture)
        => Binding.DoNothing;
}

/// <summary>Visible when the value is non-null (and not an empty string); <see cref="Invert"/> flips it.</summary>
public sealed class NullToVisibilityConverter : IValueConverter
{
    public bool Invert { get; set; }

    public object Convert(object value, Type targetType, object parameter, CultureInfo culture)
    {
        bool present = value is not null && !(value is string s && s.Length == 0);
        return present ^ Invert ? Visibility.Visible : Visibility.Collapsed;
    }

    public object ConvertBack(object value, Type targetType, object parameter, CultureInfo culture)
        => Binding.DoNothing;
}

/// <summary>Order status → status dot colour.</summary>
public sealed class StatusBrushConverter : IValueConverter
{
    public object Convert(object value, Type targetType, object parameter, CultureInfo culture) => (value as string) switch
    {
        "READY_FOR_PICKUP" or "COLLECTED" => StatusBrushes.Green,
        "PRINTING" or "QUEUED" => StatusBrushes.Accent,
        "PENDING_REVIEW" => StatusBrushes.Orange,
        "NEEDS_OPERATOR_CHECK" or "REJECTED" => StatusBrushes.Red,
        _ => StatusBrushes.Secondary,
    };

    public object ConvertBack(object value, Type targetType, object parameter, CultureInfo culture)
        => Binding.DoNothing;
}

/// <summary><see cref="ViewModels.StatusTone"/> → status dot colour (payments readiness, phones).</summary>
public sealed class StatusToneBrushConverter : IValueConverter
{
    public object Convert(object value, Type targetType, object parameter, CultureInfo culture) => value switch
    {
        ViewModels.StatusTone.Green => StatusBrushes.Green,
        ViewModels.StatusTone.Orange => StatusBrushes.Orange,
        ViewModels.StatusTone.Red => StatusBrushes.Red,
        _ => StatusBrushes.Secondary,
    };

    public object ConvertBack(object value, Type targetType, object parameter, CultureInfo culture)
        => Binding.DoNothing;
}

/// <summary>Connection state → sidebar status dot.</summary>
public sealed class ConnectionBrushConverter : IValueConverter
{
    public object Convert(object value, Type targetType, object parameter, CultureInfo culture) => value switch
    {
        ConnectionState.Connected => StatusBrushes.Green,
        ConnectionState.Offline or ConnectionState.Unauthorized => StatusBrushes.Red,
        ConnectionState.NotPaired => StatusBrushes.Secondary,
        _ => StatusBrushes.Orange,
    };

    public object ConvertBack(object value, Type targetType, object parameter, CultureInfo culture)
        => Binding.DoNothing;
}
