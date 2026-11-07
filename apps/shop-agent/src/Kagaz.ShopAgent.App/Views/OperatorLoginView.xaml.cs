using System.Windows;
using System.Windows.Controls;
using Kagaz.ShopAgent.App.ViewModels;

namespace Kagaz.ShopAgent.App.Views;

/// <summary>
/// PasswordBox can't be bound (by design), so the password is pushed to the view model on change
/// and the box is cleared after each attempt. The password is never stored anywhere else.
/// </summary>
public partial class OperatorLoginView : UserControl
{
    private OperatorLoginViewModel? _vm;

    public OperatorLoginView()
    {
        InitializeComponent();
        DataContextChanged += (_, e) =>
        {
            if (_vm is not null) _vm.PasswordCleared -= ClearPassword;
            _vm = e.NewValue as OperatorLoginViewModel;
            if (_vm is not null) _vm.PasswordCleared += ClearPassword;
        };
        Loaded += (_, _) => LoginBox.Focus();
        Unloaded += (_, _) => PasswordBox.Clear();
    }

    private void OnPasswordChanged(object sender, RoutedEventArgs e)
    {
        if (_vm is not null) _vm.Password = PasswordBox.Password;
    }

    private void ClearPassword() => Dispatcher.Invoke(() =>
    {
        if (PasswordBox.Password.Length > 0) PasswordBox.Clear();
    });
}
