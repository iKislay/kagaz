using System.Windows;
using System.Windows.Input;
using Kagaz.ShopAgent.App.ViewModels;

namespace Kagaz.ShopAgent.App.Views;

public sealed partial class PreviewWindow : Window
{
    public PreviewWindow() => InitializeComponent();

    private JobsViewModel? Jobs => DataContext as JobsViewModel;

    private void OnKeyDown(object sender, KeyEventArgs e)
    {
        switch (e.Key)
        {
            case Key.Escape:
                Close();
                break;
            case Key.Left or Key.PageUp when Jobs?.PreviousPageCommand.CanExecute(null) == true:
                Jobs.PreviousPageCommand.Execute(null);
                break;
            case Key.Right or Key.PageDown or Key.Space when Jobs?.NextPageCommand.CanExecute(null) == true:
                Jobs.NextPageCommand.Execute(null);
                break;
            default:
                return;
        }
        e.Handled = true;
    }

    private void OnPageClicked(object sender, MouseButtonEventArgs e) => e.Handled = true; // clicking the page itself keeps it open

    // Buttons mark their mouse-up handled, so this only fires for the dark background.
    private void OnBackgroundClicked(object sender, MouseButtonEventArgs e) => Close();

    private void OnCloseClicked(object sender, RoutedEventArgs e) => Close();
}
