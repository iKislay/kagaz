using System.Windows;
using System.Windows.Controls;
using System.Windows.Input;
using Kagaz.ShopAgent.App.ViewModels;

namespace Kagaz.ShopAgent.App.Views;

public sealed partial class JobsView : UserControl
{
    public JobsView() => InitializeComponent();

    private void OnPreviewImageClicked(object sender, MouseButtonEventArgs e) => OpenFullScreen();

    private void OnFullScreenClicked(object sender, RoutedEventArgs e) => OpenFullScreen();

    private void OpenFullScreen()
    {
        if (DataContext is not JobsViewModel { HasPreview: true }) return;
        new PreviewWindow { Owner = Window.GetWindow(this), DataContext = DataContext }.ShowDialog();
    }
}
