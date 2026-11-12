using System.Collections.ObjectModel;
using CommunityToolkit.Mvvm.ComponentModel;
using CommunityToolkit.Mvvm.Input;
using Kagaz.ShopAgent.Core;

namespace Kagaz.ShopAgent.App.ViewModels;

public sealed record StaffRow(string UserId, string Name, string Phone, string RoleLabel, bool IsOwner);

/// <summary>Owner page: the people who can sign in to this shop's app (mobile number + password).</summary>
public sealed partial class StaffViewModel : ObservableObject
{
    private readonly ShopApiClient? _api;

    [ObservableProperty]
    private string _newPhone = string.Empty;

    [ObservableProperty]
    private string _newName = string.Empty;

    [ObservableProperty]
    private string _newPassword = string.Empty;

    [ObservableProperty]
    private string? _message;

    [ObservableProperty]
    private bool _messageIsError;

    [ObservableProperty]
    [NotifyCanExecuteChangedFor(nameof(AddCommand), nameof(ConfirmRemoveCommand))]
    private bool _isBusy;

    /// <summary>Row awaiting "Remove?" confirmation.</summary>
    [ObservableProperty]
    private StaffRow? _confirming;

    /// <param name="api">Null in tests.</param>
    public StaffViewModel(ShopApiClient? api = null) => _api = api;

    public ObservableCollection<StaffRow> Members { get; } = new();

    public async Task LoadAsync()
    {
        if (_api is null) return;
        try
        {
            var list = await _api.GetMembersAsync();
            Members.Clear();
            foreach (var m in list.OrderByDescending(IsOwnerRole).ThenBy(m => m.Name))
            {
                Members.Add(new StaffRow(m.UserId, m.Name ?? "—", m.Phone is null ? "—" : SupportViewModel.FormatPhone(m.Phone),
                    IsOwnerRole(m) ? "Owner" : "Operator", IsOwnerRole(m)));
            }
        }
        catch (ApiException ex)
        {
            Show(OwnerError(ex), error: true);
        }
    }

    private bool CanAct() => !IsBusy;

    [RelayCommand(CanExecute = nameof(CanAct))]
    private async Task AddAsync()
    {
        if (_api is null) return;
        string phone = NewPhone.Trim(), name = NewName.Trim();
        if (phone.Count(char.IsAsciiDigit) < 10) { Show("Enter their 10-digit mobile number.", error: true); return; }
        if (name.Length < 2) { Show("Enter their name.", error: true); return; }
        if (NewPassword.Length < 8) { Show("Choose a password of at least 8 characters for them.", error: true); return; }

        IsBusy = true;
        try
        {
            await _api.AddMemberAsync(new AddShopMemberRequest(phone, name, NewPassword));
            Show($"Added {name}. They sign in to Kaggaz Shop with {SupportViewModel.FormatPhone(phone)} and the password you set.", error: false);
            NewPhone = NewName = NewPassword = string.Empty;
            await LoadAsync();
        }
        catch (ApiException ex)
        {
            Show(OwnerError(ex), error: true);
        }
        finally
        {
            IsBusy = false;
        }
    }

    [RelayCommand]
    private void AskRemove(StaffRow row) => Confirming = row;

    [RelayCommand]
    private void CancelRemove() => Confirming = null;

    [RelayCommand(CanExecute = nameof(CanAct))]
    private async Task ConfirmRemoveAsync()
    {
        if (_api is null || Confirming is not { } row) return;
        IsBusy = true;
        try
        {
            await _api.RemoveMemberAsync(row.UserId);
            Show($"Removed {row.Name}. They can no longer sign in.", error: false);
            Confirming = null;
            await LoadAsync();
        }
        catch (ApiException ex)
        {
            Show(OwnerError(ex), error: true);
        }
        finally
        {
            IsBusy = false;
        }
    }

    private static bool IsOwnerRole(ShopMember m) => m.Role is "SHOP_OWNER" or "OWNER";

    /// <summary>Errors for owner-only calls; 404 means the server predates these pages.</summary>
    public static string OwnerError(ApiException ex) => ex.HttpStatus == 404
        ? "Update your Kaggaz server to manage this from the app."
        : PairingViewModel.CommonError(ex);

    private void Show(string text, bool error)
    {
        Message = text;
        MessageIsError = error;
    }
}
