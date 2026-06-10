using System.Windows;
using System.Windows.Controls;

namespace CollegeCounselor;

internal sealed class MainTabs : UserControl
{
    public MainTabs()
    {
        var tabs = new TabControl { Background = Theme.Bg, BorderThickness = new Thickness(0) };
        tabs.Items.Add(new TabItem { Header = "College Fit", Content = new FitView() });
        tabs.Items.Add(new TabItem { Header = "Chat", Content = new ChatView() });
        tabs.Items.Add(new TabItem { Header = "Settings", Content = new SettingsView() });
        Content = tabs;
    }
}
