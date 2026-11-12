using System.Windows;
using System.Windows.Controls;
using System.Windows.Media;

namespace Kagaz.ShopAgent.App.Views;

public sealed partial class ShopQrView : UserControl
{
    public ShopQrView() => InitializeComponent();

    /// <summary>
    /// Prints the poster as one page, scaled to the printer's printable area. This is shop
    /// stationery, not an order: it never goes through the print-job lease/packet pipeline.
    /// </summary>
    private void Print_Click(object sender, RoutedEventArgs e)
    {
        var dialog = new PrintDialog();
        if (dialog.ShowDialog() != true) return;

        var page = new Size(dialog.PrintableAreaWidth, dialog.PrintableAreaHeight);
        var sheet = new Viewbox
        {
            Child = new ShopPoster { DataContext = DataContext },
            Stretch = Stretch.Uniform,
            Width = page.Width,
            Height = page.Height,
        };
        sheet.Measure(page);
        sheet.Arrange(new Rect(page));
        sheet.UpdateLayout();
        dialog.PrintVisual(sheet, "Kaggaz QR poster");
    }
}
