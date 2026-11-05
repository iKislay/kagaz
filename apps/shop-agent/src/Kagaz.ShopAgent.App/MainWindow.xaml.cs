using Kagaz.ShopAgent.App.ViewModels;
using System.Windows;

namespace Kagaz.ShopAgent.App;

public sealed partial class MainWindow : Window
{
    public MainWindow(ShellViewModel viewModel)
    {
        InitializeComponent();
        DataContext = viewModel;
    }
}
