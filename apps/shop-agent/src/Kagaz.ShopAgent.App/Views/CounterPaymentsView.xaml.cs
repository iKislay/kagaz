using System.Windows.Controls;
using System.Windows.Input;
using Kagaz.ShopAgent.App.ViewModels;

namespace Kagaz.ShopAgent.App.Views;

public sealed partial class CounterPaymentsView : UserControl
{
    public CounterPaymentsView() => InitializeComponent();

    /// <summary>Enter finds the customer with the typed pickup number.</summary>
    private void OnNumberKeyDown(object sender, KeyEventArgs e)
    {
        if (e.Key != Key.Enter) return;
        e.Handled = true;
        if (DataContext is CounterPaymentsViewModel vm && vm.FindCommand.CanExecute(null)) vm.FindCommand.Execute(null);
    }
}
