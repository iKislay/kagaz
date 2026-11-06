using System.Windows;
using System.Windows.Controls;
using Kagaz.ShopAgent.App.ViewModels;

namespace Kagaz.ShopAgent.App.Views;

public sealed partial class PrintersView : UserControl
{
    public PrintersView()
    {
        InitializeComponent();
    }

    private async void OnLoaded(object sender, RoutedEventArgs e)
    {
        if (DataContext is PrintersViewModel vm)
        {
            await vm.LoadAsync();
        }
    }
}
