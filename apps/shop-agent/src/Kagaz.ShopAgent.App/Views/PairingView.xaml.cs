using System.Windows;
using System.Windows.Controls;
using Kagaz.ShopAgent.App.ViewModels;

namespace Kagaz.ShopAgent.App.Views;

/// <summary>
/// PasswordBox can't be bound (by design): passwords are pushed to the view model on change and the
/// boxes are cleared after every attempt. They are never stored anywhere else.
/// </summary>
public sealed partial class PairingView : UserControl
{
    private PairingViewModel? _vm;

    public PairingView()
    {
        InitializeComponent();
        DataContextChanged += (_, e) =>
        {
            if (_vm is not null) _vm.PasswordsCleared -= ClearPasswords;
            _vm = e.NewValue as PairingViewModel;
            if (_vm is not null) _vm.PasswordsCleared += ClearPasswords;
        };
        Unloaded += (_, _) => ClearPasswords();
    }

    private void OnPasswordChanged(object sender, RoutedEventArgs e)
    {
        if (_vm is not null) _vm.Password = SignInPassword.Password;
    }

    private void OnSignUpPasswordChanged(object sender, RoutedEventArgs e)
    {
        if (_vm is not null) _vm.SignUpPassword = SignUpPassword.Password;
    }

    private void OnSignUpConfirmChanged(object sender, RoutedEventArgs e)
    {
        if (_vm is not null) _vm.SignUpConfirm = SignUpConfirm.Password;
    }

    private void ClearPasswords() => Dispatcher.Invoke(() =>
    {
        foreach (var box in new[] { SignInPassword, SignUpPassword, SignUpConfirm })
        {
            if (box.Password.Length > 0) box.Clear();
        }
    });
}
