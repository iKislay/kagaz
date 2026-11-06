using Kagaz.ShopAgent.App.ViewModels;

namespace Kagaz.ShopAgent.Tests;

public class PickupCodeNormalizationTests
{
    [Theory]
    [InlineData("abcd-efgh", "ABCDEFGH")]
    [InlineData("ABCD EFGH", "ABCDEFGH")]
    [InlineData(" ab-cd ef-gh ", "ABCDEFGH")]
    [InlineData("Z9Y8X7W6", "Z9Y8X7W6")]
    [InlineData("", "")]
    [InlineData("   -  ", "")]
    public void Normalize_uppercases_and_strips_spaces_and_dashes(string input, string expected)
    {
        Assert.Equal(expected, PickupViewModel.Normalize(input));
    }

    [Theory]
    [InlineData("ABCDEFGH", true)]
    [InlineData("23456789", true)]
    [InlineData("ABCDEFG", false)]   // too short
    [InlineData("ABCDEFGHJ", false)] // too long
    [InlineData("ABCDEFG0", false)]  // 0 is not in the alphabet
    [InlineData("ABCDEFGO", false)]  // O is not in the alphabet
    [InlineData("ABCDEFG1", false)]  // 1 is not in the alphabet
    [InlineData("ABCDEFGI", false)]  // I is not in the alphabet
    public void Only_8_chars_from_the_pickup_alphabet_are_well_formed(string code, bool expected)
    {
        Assert.Equal(expected, PickupViewModel.IsWellFormed(code));
    }
}
